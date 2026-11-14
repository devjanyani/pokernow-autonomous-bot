// ============================================================
// Postflop behaviour model: how likely a holding is to bet, raise, call or
// check in a given spot. ONE model serves two jobs, so they stay consistent:
//
//   1. narrowing an opponent's range after each observed action (Bayes:
//      weight *= P(action | holding)), and
//   2. predicting opponents' responses to Hero's candidate bets inside the
//      EV simulation (fold / call / raise probabilities per holding).
//
// STATUS: HEURISTIC. The functional forms (logistic in "effective strength")
// and constants below are hand-set approximations of typical play, not solver
// output. They are adjusted per opponent by measured tendencies (see
// opponents/profile.ts), with the adjustment shrunk toward zero on small
// samples.
// ============================================================

import { CardId, COMBO_HI, COMBO_LO, NUM_COMBOS, rankOf, suitOf } from '../cards';
import { evaluateHand } from '../../core/equity/hand-eval';
import type { Street } from '../table/engine';

export interface BoardFeatures {
  board: CardId[];
  /** Made-hand percentile vs all other possible holdings (1 = nuts), -1 if the combo is blocked by the board. */
  hs: Float32Array;
  /** Effective strength: hs plus the chance of improving on a draw (equal to hs on the river). */
  es: Float32Array;
  /** Draw outs counted for the combo (flush 9, open-ended 8, gutshot 4). */
  outs: Uint8Array;
}

const STRAIGHT_MASKS: number[] = (() => {
  const m: number[] = [0b1000000001111]; // A-5 (ace low)
  for (let lo = 0; lo <= 8; lo++) m.push(0b11111 << lo);
  return m;
})();
const hasStraight = (mask: number): boolean => {
  for (const s of STRAIGHT_MASKS) if ((mask & s) === s) return true;
  return false;
};

/** Per-combo strength features for a 3-5 card board. O(1326) evaluations. */
export function computeFeatures(board: readonly CardId[]): BoardFeatures {
  if (board.length < 3 || board.length > 5) throw new RangeError('computeFeatures needs a 3-5 card board');
  const hs = new Float32Array(NUM_COMBOS).fill(-1);
  const es = new Float32Array(NUM_COMBOS).fill(-1);
  const outs = new Uint8Array(NUM_COMBOS);
  const onBoard = new Uint8Array(52);
  let boardRankMask = 0;
  const boardSuit = [0, 0, 0, 0];
  for (const c of board) { onBoard[c] = 1; boardRankMask |= 1 << rankOf(c); boardSuit[suitOf(c)]++; }

  const ranks = new Int32Array(NUM_COMBOS);
  const live: number[] = [];
  const cards: number[] = [0, 0, ...board];
  for (let k = 0; k < NUM_COMBOS; k++) {
    const a = COMBO_LO[k], b = COMBO_HI[k];
    if (onBoard[a] || onBoard[b]) continue;
    cards[0] = a; cards[1] = b;
    ranks[k] = evaluateHand(cards);
    live.push(k);
  }
  // Percentile with ties at the midpoint.
  const sorted = live.slice().sort((x, y) => ranks[x] - ranks[y]);
  const n = sorted.length;
  for (let i = 0; i < n;) {
    let j = i;
    while (j < n && ranks[sorted[j]] === ranks[sorted[i]]) j++;
    const pct = (i + j - 1) / 2 / Math.max(1, n - 1);
    for (let t = i; t < j; t++) hs[sorted[t]] = pct;
    i = j;
  }

  const toCome = 5 - board.length;
  for (const k of live) {
    let o = 0;
    if (toCome > 0) {
      const a = COMBO_LO[k], b = COMBO_HI[k];
      const sa = suitOf(a), sb = suitOf(b);
      // Flush draw: exactly four of a suit using at least one hole card.
      const cntA = boardSuit[sa] + 1 + (sb === sa ? 1 : 0);
      const cntB = boardSuit[sb] + 1 + (sb === sa ? 1 : 0);
      if (cntA === 4 || (sb !== sa && cntB === 4)) o += 9;
      // Straight draws: ranks that complete a straight only with a hole card.
      const all = boardRankMask | (1 << rankOf(a)) | (1 << rankOf(b));
      if (!hasStraight(all)) {
        let sr = 0;
        for (let r = 0; r < 13; r++) {
          const bit = 1 << r;
          if (all & bit) continue;
          if (hasStraight(all | bit) && !hasStraight(boardRankMask | bit)) sr++;
        }
        o += Math.min(sr, 2) * 4;
      }
      o = Math.min(o, 15);
    }
    outs[k] = o;
    const pHit = toCome === 2 ? 1 - ((47 - o) / 47) * ((46 - o) / 46) : toCome === 1 ? o / 46 : 0;
    es[k] = hs[k] + (1 - hs[k]) * pHit * 0.85;
  }
  return { board: board.slice(), hs, es, outs };
}

// ---- per-opponent behavioural knobs ----------------------------------------

/**
 * Tendencies relative to the default model (all 0 = default). Produced by
 * opponents/profile.ts from measured statistics with shrinkage.
 */
export interface Tendencies {
  /** > 0 bluffs / bets more than the default, < 0 less. Range about -1..1. */
  aggression: number;
  /** > 0 continues (calls) more than the default vs bets, < 0 folds more. Range about -1..1. */
  stickiness: number;
  /** Preflop looseness: multiplier on entering ranges (1 = default). */
  looseness: number;
  /** Preflop raise tendency: multiplier on raising ranges (1 = default). */
  preflopAggression: number;
}
export const NEUTRAL: Tendencies = { aggression: 0, stickiness: 0, looseness: 1, preflopAggression: 1 };

/**
 * Who holds the betting lead when a player may bet first on a street.
 *   'aggressor'       the actor made the last bet or raise on the previous street (a continuation bet)
 *   'into-aggressor'  the previous street's aggressor is still to act behind the actor (a lead / donk bet)
 *   'neutral'         nobody holds the lead: limped pot, the previous street was checked through,
 *                     or the aggressor has already checked this street (probe / delayed bet)
 */
export type BetRole = 'aggressor' | 'into-aggressor' | 'neutral';

/**
 * HEURISTIC constants for the lead. They are round figures in line with commonly reported population
 * tendencies (the preflop raiser bets most flops; players rarely lead into the raiser), not solver output.
 */
export const ROLE_MODEL = {
  /** Continuation bet: value threshold lowered by this much and the bluff rate multiplied. */
  cbetThresholdShift: -0.06,
  cbetBluffMult: 1.7,
  /** Share of would-be bets that are actually led into the aggressor; the rest are checked to the aggressor. */
  leadShare: 0.3,
  /**
   * Smallest likelihood of a check for any holding when narrowing a range: strong hands are slow-played
   * often enough that a check must never all but remove them. (Version 1 used 0.02, which let a
   * check-check-bet line collapse a range to a few leftover combos.)
   */
  trapFloor: 0.2,
};

export interface SpotContext {
  street: Street;
  /** Bet size as a fraction of the pot before the bet (for check: ignored). */
  betFrac: number;
  /** Opponents the actor has to get through (>= 1). */
  opponents: number;
  /** True when the action is a raise over a bet (or the bet being faced is a raise). */
  isRaise: boolean;
  tend: Tendencies;
  /** Betting lead of the actor when it may bet first. Omitted = 'neutral' (the version 1 behaviour). */
  role?: BetRole;
}

const sig = (x: number): number => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const BLUFF_BASE: Record<Street, number> = { preflop: 0, flop: 0.3, turn: 0.2, river: 0.12 };

/** P(bets or raises | holding with effective strength es). */
export function betProb(es: number, c: SpotContext): number {
  const x = clamp(c.betFrac, 0.1, 3);
  const role = c.isRaise ? 'neutral' : c.role ?? 'neutral';
  let tv = 0.58 + 0.1 * Math.min(x, 1.5) + 0.04 * (c.opponents - 1) + (c.isRaise ? 0.17 : 0) + (c.street === 'river' ? 0.05 : 0);
  if (role === 'aggressor') tv += ROLE_MODEL.cbetThresholdShift;
  const value = sig((es - tv) / 0.06);
  let bluff = BLUFF_BASE[c.street] * (c.isRaise ? 0.3 : 1) / (1 + 0.6 * (c.opponents - 1));
  if (role === 'aggressor') bluff *= ROLE_MODEL.cbetBluffMult;
  bluff *= clamp(1 + 0.8 * c.tend.aggression, 0.2, 2.2);
  bluff = Math.min(bluff, 0.85);
  const p = value + (1 - value) * bluff;
  // Leading into the previous street's aggressor is uncommon with every kind of holding: most of the
  // hands that would bet check to the aggressor instead, so that check says little about the hand.
  return clamp(role === 'into-aggressor' ? p * ROLE_MODEL.leadShare : p, 0.01, 0.99);
}

/** Strength threshold above which a holding mostly continues versus a bet of size x (pot fraction). */
export function continueThreshold(c: SpotContext): number {
  const x = clamp(c.betFrac, 0.05, 4);
  // 0.33 pot -> 0.36, 0.66 -> 0.46, pot -> 0.54, 2x pot -> 0.66 (flop/turn).
  let t = 0.22 + 0.32 * Math.sqrt(x);
  if (c.street === 'river') t += 0.06;
  if (c.isRaise) t += 0.1;
  t += 0.03 * (c.opponents - 1);
  t -= 0.12 * c.tend.stickiness;
  return clamp(t, 0.05, 0.97);
}

export interface Response { fold: number; call: number; raise: number }

/** Response of a holding facing a bet. Probabilities sum to 1. */
export function responseProbs(es: number, c: SpotContext): Response {
  const cont = sig((es - continueThreshold(c)) / 0.06);
  const valueRaise = sig((es - (c.isRaise ? 0.95 : 0.9)) / 0.03) * 0.6;
  const bluffRaise = (c.street === 'river' ? 0.02 : 0.04) * clamp(1 + c.tend.aggression, 0.2, 2.5) * (c.isRaise ? 0.4 : 1);
  const raise = clamp(cont * valueRaise + (1 - cont) * bluffRaise + cont * bluffRaise * 0.5, 0, 0.95);
  const call = clamp(cont - cont * valueRaise - cont * bluffRaise * 0.5, 0, 1);
  const fold = clamp(1 - call - raise, 0, 1);
  const s = fold + call + raise;
  return { fold: fold / s, call: call / s, raise: raise / s };
}

/** P(checks | holding) when checking is free. */
export function checkProb(es: number, c: SpotContext): number {
  return 1 - betProb(es, { ...c, betFrac: 0.6, isRaise: false });
}

export type ObservedKind = 'check' | 'call' | 'bet' | 'raise';

/** Likelihood of an observed action for a holding (used for Bayesian range narrowing). */
export function actionLikelihood(kind: ObservedKind, es: number, c: SpotContext): number {
  switch (kind) {
    case 'bet': return betProb(es, { ...c, isRaise: false });
    case 'raise': return Math.max(0.004, responseProbs(es, c).raise);
    case 'call': return Math.max(0.004, responseProbs(es, c).call);
    case 'check': return Math.max(c.role === undefined ? 0.02 : ROLE_MODEL.trapFloor, checkProb(es, c));
  }
}
