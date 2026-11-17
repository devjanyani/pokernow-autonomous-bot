// ============================================================
// Offline adapter for the already-trained postflop model (src/core/ml, trained on PokerBench solver labels).
//
// EXPERIMENTAL. The active bot (src/bot/agent.ts) does not use this model and this file does not change that:
// it lives in sim/, is not bundled into the extension, and is used only by offline comparisons. Nothing here
// replaces or feeds the strategy engines.
//
// What the model is. A small network that maps a 51-number description of a HEADS-UP POSTFLOP decision to one
// of five action classes (fold, check, call, bet, raise) and, separately, a bet-size bucket. It was fitted to
// reproduce the single action a solver chose in PokerBench rows: 6-max, 100 big blinds, heads-up after the
// flop. Its recorded agreement with held-out rows is 84.5%. Agreement with solver labels says nothing direct
// about profit, and nothing at all outside that setting.
//
// What the adapter does.
//   - builds the model's `Spot` from the bot's hand state with the SAME definitions the training data used
//     (documented in src/core/ml/serve-spot.ts), or says why the spot is not one the model was trained for;
//   - takes the legal-action mask from the rules engine, so the model can never name an illegal action;
//   - reports how far a set of spots is from the data the model was trained on (`shiftReport`).
//
// Things the model cannot see, by construction of its 51 inputs: stack depth and stack-to-pot ratio (the
// training data was all 100 big blinds deep), the number of players, anything about the opponent, the sizes
// of earlier bets. Those are reported as limits, not worked around.
// ============================================================

import type { CardId } from '../../src/bot/cards';
import { HandState, LegalActions, potTotal, seatOf } from '../../src/bot/table/engine';
import { encodeSpot, FEATURE_DIM, legalMaskFromFeatures, Spot } from '../../src/core/ml/features';
import { predictBetSize, predictPostflop } from '../../src/core/ml/policy';

export interface MlSpot {
  spot: Spot;
  /** Why the spot lies outside what the model was trained on (empty when it is inside). */
  outside: string[];
  potChips: number;
}

/** Dataset conventions: a bet is offered at about three quarters of the pot, a raise at about 3.2 times the bet faced. */
export const OFFERED_BET_FRAC = 0.75;
export const OFFERED_RAISE_MULT = 3.17;

/**
 * The model's view of a decision, or null when the model does not apply at all (preflop, or more than two
 * players still in the hand: the training data has no such rows).
 */
export function mlSpot(h: HandState, seat: number, hole: [CardId, CardId], la: LegalActions): MlSpot | null {
  if (h.street === 'preflop' || h.board.length < 3) return null;
  const live = h.seats.filter((s) => s.dealtIn && !s.folded);
  if (live.length !== 2) return null;
  const me = seatOf(h, seat);
  const villain = live.find((s) => s.seat !== seat)!;
  const pot = potTotal(h);                                    // includes this street's chips, as in the dataset
  const facingBet = la.callAmount > 0;
  // In position = acts last after the flop.
  const isIP = (me.pos?.postflopOrder ?? 0) > (villain.pos?.postflopOrder ?? 0);
  const canBet = la.canRaise && la.raiseKind === 'bet', canRaise = la.canRaise && la.raiseKind === 'raise';
  const offered = canBet ? Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, me.streetCommit + OFFERED_BET_FRAC * pot))
    : canRaise ? Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, OFFERED_RAISE_MULT * h.currentBet)) : 0;
  const lastPreflopRaiser = [...h.events].reverse().find((e) => e.street === 'preflop' && (e.kind === 'raise' || e.kind === 'bet'))?.seat;
  const spot: Spot = {
    holeCards: hole, board: h.board.slice(), street: h.street as 'flop' | 'turn' | 'river', heroPos: isIP ? 'IP' : 'OOP',
    facingBet, toCallFrac: facingBet ? h.currentBet / pot : 0, offeredSizeFrac: offered > 0 ? offered / pot : 0,
    canCheck: la.canCheck, canBet, canCall: la.canCall, canRaise, canFold: !la.canCheck,
    threeBetPot: false, isPreflopAggressor: lastPreflopRaiser === seat, facedRaiseThisStreet: h.raisesThisStreet >= 2, streetBetCount: h.raisesThisStreet,
  };
  const outside: string[] = [];
  const bb = h.bigBlind;
  const eff = Math.min(me.startStack, villain.startStack) / bb;
  if (eff < 60 || eff > 140) outside.push(`effective stack ${eff.toFixed(0)} bb at the start of the hand (trained at 100)`);
  if (h.seats.filter((s) => s.dealtIn).length === 2) outside.push('heads-up table (trained on six-handed games that became heads-up after the flop)');
  if (h.ante > 0) outside.push('ante');
  if (me.allIn || villain.allIn) outside.push('a player is all-in');
  if (!h.events.some((e) => e.street === 'preflop' && e.kind === 'raise')) outside.push('limped pot (no raise before the flop)');
  return { spot, outside, potChips: pot };
}

export interface MlAdvice { action: 'fold' | 'check' | 'call' | 'bet' | 'raise'; to?: number; label: string; probs: Record<string, number>; outside: string[] }

/** The model's recommendation as an action the rules engine accepts. Null when the model does not apply. */
export function mlAdvice(h: HandState, seat: number, hole: [CardId, CardId], la: LegalActions): MlAdvice | null {
  const m = mlSpot(h, seat, hole, la);
  if (!m) return null;
  const p = predictPostflop(m.spot);
  const me = seatOf(h, seat);
  let action = p.action as MlAdvice['action'];
  // The mask comes from the same flags, so this cannot fire; kept as a final guard, never as a strategy rule.
  const legal = (a: string) => (a === 'fold' ? !la.canCheck : a === 'check' ? la.canCheck : a === 'call' ? la.canCall : a === 'bet' ? la.canRaise && la.raiseKind === 'bet' : la.canRaise && la.raiseKind === 'raise');
  if (!legal(action)) action = la.canCheck ? 'check' : 'fold';
  let to: number | undefined;
  if (action === 'bet' || action === 'raise') {
    const frac = predictBetSize(m.spot).fraction;
    const raw = action === 'bet' ? me.streetCommit + frac * m.potChips : h.currentBet + frac * (m.potChips + la.callAmount);
    to = Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, Math.round(raw)));
  }
  return { action, to, label: `${action}${to !== undefined ? ` ${to}` : ''}`, probs: p.probs, outside: m.outside };
}

/** True when the mask the model applies equals the rules engine's legal actions for the same decision. */
export function maskMatchesRules(spot: Spot, la: LegalActions): boolean {
  const mask = legalMaskFromFeatures(encodeSpot(spot));
  const want = [!la.canCheck, la.canCheck, la.canCall, la.canRaise && la.raiseKind === 'bet', la.canRaise && la.raiseKind === 'raise'];
  return mask.every((x, i) => (x > 0.5) === want[i]);
}

// ---- distribution shift -----------------------------------------------------------------------

export const FEATURE_NAMES: string[] = (() => {
  const n = Array.from({ length: FEATURE_DIM }, (_, i) => `f${i}`);
  const set = (i: number, s: string) => { n[i] = s; };
  ['high card', 'pair', 'two pair', 'three of a kind', 'straight', 'flush', 'full house', 'four of a kind', 'straight flush'].forEach((s, i) => set(i, `made hand: ${s}`));
  ['equity against a random hand', 'high card rank', 'low card rank', 'suited', 'pocket pair', 'both broadway', 'gap between hole cards', 'board monotone', 'board two-tone', 'board paired', 'most cards of one suit on board', 'board connectedness', 'top board rank', 'broadway cards on board', 'street: flop', 'street: turn', 'street: river', 'in position', 'facing a bet', 'bet faced / pot', 'offered size / pot', 'log(1 + offered size / pot)', 'three-bet pot (unused)', 'may fold', 'may check', 'may call', 'may bet', 'may raise', 'flush draw', 'nut flush draw', 'open-ended straight draw', 'gutshot', 'combo draw', 'two overcards', 'overpair', 'top pair', 'second pair or worse', 'pair kicker rank', 'board cards above the pair', 'preflop aggressor', 'raised this street', 'bets and raises this street'].forEach((s, i) => set(9 + i, s));
  return n;
})();

export interface ShiftRow { feature: string; reference: number; sample: number; smd: number; outOfRange: number }
/**
 * Per-feature comparison of two sets of spots. `smd` is the difference of means in units of the reference
 * standard deviation; `outOfRange` is the share of the sample outside the reference's observed range.
 * Features the model ignores (constant in the reference) are reported with smd = 0 unless the sample varies.
 */
export function shiftReport(reference: readonly Spot[], sample: readonly Spot[]): ShiftRow[] {
  const enc = (xs: readonly Spot[]) => xs.map((s) => encodeSpot(s));
  const R = enc(reference), S = enc(sample);
  const rows: ShiftRow[] = [];
  for (let f = 0; f < FEATURE_DIM; f++) {
    let rs = 0, rq = 0, lo = Infinity, hi = -Infinity;
    for (const x of R) { rs += x[f]; rq += x[f] * x[f]; if (x[f] < lo) lo = x[f]; if (x[f] > hi) hi = x[f]; }
    const rm = rs / R.length, sd = Math.sqrt(Math.max(0, rq / R.length - rm * rm));
    let ss = 0, out = 0;
    for (const x of S) { ss += x[f]; if (x[f] < lo - 1e-6 || x[f] > hi + 1e-6) out++; }
    const sm = S.length ? ss / S.length : NaN;
    rows.push({ feature: FEATURE_NAMES[f], reference: rm, sample: sm, smd: sd > 1e-9 ? (sm - rm) / sd : Math.abs(sm - rm) > 1e-9 ? Infinity : 0, outOfRange: S.length ? out / S.length : 0 });
  }
  return rows;
}
