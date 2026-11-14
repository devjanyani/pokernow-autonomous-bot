// ============================================================
// Range-aware behaviour model (version 2 engine).
//
// The version 1 model (postflop-model.ts) measured a holding against ALL 1326
// possible hands: "continue against a third-pot bet when the hand is better
// than 43% of random hands". A range that has called a raise before the flop is
// much stronger than random, so that rule made almost every hand in it continue
// against every bet, and made the same hand equally strong whatever range it
// sat in.
//
// Here a holding's strength has three computed parts:
//
//     qOwn  share of the player's OWN range (by weight) that the holding beats
//           -> "how good is this hand among the hands I can have here"
//     qOpp  share of the OPPONENTS' ranges that the holding beats
//           -> "how good is this hand against what they can have"
//     es    the old absolute measure (place among all possible hands)
//
//     s = W_OWN * qOwn + W_OPP * qOpp + W_ABS * es        (draws count through es)
//
// and the thresholds are applied to s. With equal ranges they read as fractions
// of a range: "fold the bottom 40% of the range to a third-pot bet", "bet the
// top 28% for value and bluff 17% of the rest". When one range is stronger than
// the other on a board (a RANGE ADVANTAGE), qOpp moves every hand of the
// stronger range up and every hand of the weaker range down: the stronger range
// bets more and folds less, the weaker range the opposite. Nothing about
// "raiser's board" or "caller's board" is hard-coded; it comes out of the two
// ranges and the board.
//
// The ranges used are the ones the model assigns from the betting so far. For
// Hero that is Hero's PERCEIVED range (what a player taking Hero's line would
// hold), which is deliberately not the same thing as Hero's actual two cards.
//
// STATUS: HEURISTIC. The weights are hand-set. The frequencies below were set
// so that two equal ranges on an average board reproduce the population priors
// already used for opponent statistics (opponents/profile.ts PRIORS:
// continuation bet 55% flop / 45% turn, bet when checked to 40 / 38 / 35%, fold
// to a bet about 45%). They are not solver output. tests/bot/strategy-v2.test.ts
// checks the calibration.
// ============================================================

import { NUM_COMBOS } from '../cards';
import type { Street } from '../table/engine';
import { BetRole, BoardFeatures, Response, SpotContext } from './postflop-model';
import type { Range } from './range';

const sig = (x: number): number => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export const RANGE_MODEL = {
  /** Weights of the three strength parts (sum to 1). */
  wOwn: 0.35,
  wOpp: 0.35,
  wAbs: 0.30,
  /** Share of a range bet for value at the reference size (60% pot), by betting lead and street. */
  valueTop: {
    neutral: { preflop: 0, flop: 0.28, turn: 0.27, river: 0.27 },
    aggressor: { preflop: 0, flop: 0.34, turn: 0.30, river: 0.30 },
  } as Record<'neutral' | 'aggressor', Record<Street, number>>,
  /** Share of the remaining hands that bluff. */
  bluff: {
    neutral: { preflop: 0, flop: 0.17, turn: 0.15, river: 0.11 },
    aggressor: { preflop: 0, flop: 0.32, turn: 0.21, river: 0.14 },
  } as Record<'neutral' | 'aggressor', Record<Street, number>>,
  /** Share of would-be bets actually led into the previous street's aggressor. */
  leadShare: 0.3,
  /** Smallest likelihood of a check for any holding when narrowing (slow-plays). */
  trapFloor: 0.2,
  /** Smallest likelihood of a call or a raise for any holding when narrowing. */
  actionFloor: 0.02,
  /**
   * Shift of the fold threshold per unit of measured stickiness. Stickiness is (0.46 - measured fold rate) / 0.25,
   * shrunk for small samples, so 0.25 applies the measured fold rate at face value: a player seen folding to 6%
   * of bets folds about 40 points less than the default. (Version 1 used 0.12 against a default that hardly folded.)
   */
  stickinessShift: 0.25,
};

/** Strength below which a holding mostly folds to a bet of size x (pot fraction). Between equal ranges this is close to the share of the range that folds. */
export function continueThreshold2(c: SpotContext): number {
  const x = clamp(c.betFrac, 0.05, 4);
  let t = 0.22 + 0.32 * Math.sqrt(x);          // 0.33 pot -> 0.40, 0.5 -> 0.45, pot -> 0.54, 2x pot -> 0.67
  if (c.street === 'river') t += 0.06;
  if (c.isRaise) t += 0.1;
  t += 0.03 * (c.opponents - 1);
  t -= RANGE_MODEL.stickinessShift * c.tend.stickiness;
  return clamp(t, 0.02, 0.97);
}

const ORDER = new WeakMap<BoardFeatures, Int16Array>();
/** Unblocked combos sorted by effective strength, weakest first (cached per board). */
export function boardOrder(f: BoardFeatures): Int16Array {
  let o = ORDER.get(f);
  if (!o) {
    const idx: number[] = [];
    for (let k = 0; k < NUM_COMBOS; k++) if (f.es[k] >= 0) idx.push(k);
    idx.sort((x, y) => f.es[x] - f.es[y]);
    o = Int16Array.from(idx);
    ORDER.set(f, o);
  }
  return o;
}

/**
 * For every unblocked holding: the share of `range` (by weight) with lower effective strength, ties
 * counting half. Blocked holdings are -1. An empty range gives the absolute strength instead.
 */
export function quantileTable(range: Range, f: BoardFeatures): Float32Array {
  const out = new Float32Array(NUM_COMBOS).fill(-1);
  const idx = boardOrder(f);
  let total = 0;
  for (let i = 0; i < idx.length; i++) total += range[idx[i]];
  if (!(total > 0)) { for (let i = 0; i < idx.length; i++) out[idx[i]] = f.es[idx[i]]; return out; }
  let cum = 0;
  for (let i = 0; i < idx.length;) {
    let j = i, w = 0;
    const e = f.es[idx[i]];
    while (j < idx.length && f.es[idx[j]] === e) { w += range[idx[j]]; j++; }
    const q = (cum + w / 2) / total;
    for (let t = i; t < j; t++) out[idx[t]] = q;
    cum += w;
    i = j;
  }
  return out;
}

/** Equal-weight mixture of ranges (each normalised first). */
export function mixRanges(ranges: readonly Range[]): Range {
  const out = new Float64Array(NUM_COMBOS);
  for (const r of ranges) {
    let t = 0;
    for (let k = 0; k < NUM_COMBOS; k++) t += r[k];
    if (!(t > 0)) continue;
    for (let k = 0; k < NUM_COMBOS; k++) out[k] += r[k] / t;
  }
  return out;
}

/** Strength of every holding for a player with range `own` against the mixture `opp` of the other players' ranges. */
export function strengthTable(own: Range, opp: Range, f: BoardFeatures): Float32Array {
  const qo = quantileTable(own, f), qp = quantileTable(opp, f);
  const out = new Float32Array(NUM_COMBOS).fill(-1);
  const { wOwn, wOpp, wAbs } = RANGE_MODEL;
  for (let k = 0; k < NUM_COMBOS; k++) if (f.es[k] >= 0) out[k] = wOwn * qo[k] + wOpp * qp[k] + wAbs * f.es[k];
  return out;
}

/**
 * Strength of Hero's ACTUAL hand: its place against the opponents' ranges and its absolute strength. Hero's own
 * perceived range is not used here, because the hand actually held need not be in it.
 */
export function heroStrength(opp: Range, f: BoardFeatures, heroCombo: number): number {
  const q = quantileTable(opp, f)[heroCombo];
  const { wOwn, wOpp, wAbs } = RANGE_MODEL;
  return (wOwn + wOpp) * q + wAbs * f.es[heroCombo];
}

/** After continuing against a bet with fold threshold t, a range is its top (1 - t): re-express a strength inside it. */
export const conditionOnContinue = (s: number, t: number): number => (t <= 0 ? s : clamp((s - t) / Math.max(1e-6, 1 - t), 0, 1));

/** P(bets | strength s) when the player may bet first. */
export function betProb2(s: number, c: SpotContext): number {
  const x = clamp(c.betFrac, 0.1, 3);
  const role: BetRole = c.role ?? 'neutral';
  const key = role === 'aggressor' ? 'aggressor' : 'neutral';
  const tv = 1 - RANGE_MODEL.valueTop[key][c.street] + 0.1 * (Math.min(x, 1.5) - 0.6) + 0.04 * (c.opponents - 1);
  const value = sig((s - tv) / 0.05);
  let bluff = RANGE_MODEL.bluff[key][c.street] / (1 + 0.6 * (c.opponents - 1));
  bluff = Math.min(0.85, bluff * clamp(1 + 0.8 * c.tend.aggression, 0.2, 2.2));
  const p = value + (1 - value) * bluff;
  return clamp(role === 'into-aggressor' ? p * RANGE_MODEL.leadShare : p, 0.01, 0.99);
}

/** Response of a holding with strength s facing a bet. Probabilities sum to 1. */
export function responseProbs2(s: number, c: SpotContext): Response {
  const cont = sig((s - continueThreshold2(c)) / 0.05);
  const valueRaise = sig((s - (c.isRaise ? 0.95 : 0.9)) / 0.03) * 0.7;
  const bluffRaise = (c.street === 'river' ? 0.02 : 0.04) * clamp(1 + c.tend.aggression, 0.2, 2.5) * (c.isRaise ? 0.4 : 1);
  const raise = clamp(cont * valueRaise + (1 - cont) * bluffRaise + cont * bluffRaise * 0.5, 0, 0.95);
  const call = clamp(cont - cont * valueRaise - cont * bluffRaise * 0.5, 0, 1);
  const fold = clamp(1 - call - raise, 0, 1);
  const t = fold + call + raise;
  return { fold: fold / t, call: call / t, raise: raise / t };
}

export type ObservedKind2 = 'check' | 'call' | 'bet' | 'raise';

/** Likelihood of an observed action for a holding of strength s (Bayesian narrowing). */
export function actionLikelihood2(kind: ObservedKind2, s: number, c: SpotContext): number {
  switch (kind) {
    case 'bet': return betProb2(s, { ...c, isRaise: false });
    case 'raise': return Math.max(RANGE_MODEL.actionFloor, responseProbs2(s, c).raise);
    case 'call': return Math.max(RANGE_MODEL.actionFloor, responseProbs2(s, c).call);
    case 'check': return Math.max(RANGE_MODEL.trapFloor, 1 - betProb2(s, { ...c, betFrac: 0.6, isRaise: false }));
  }
}
