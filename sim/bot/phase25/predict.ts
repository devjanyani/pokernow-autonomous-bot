// ============================================================
// Phase 2.5: version 3's own opponent model, evaluated on real decisions.
//
// For a decision in a heads-up pot after the flop, the acting player's range is estimated from the PUBLIC view
// (buildTable with the other player as observer and no hidden card removed: the observer's "cards" are two board
// cards, which are dead anyway), the strength of every holding in it is computed exactly as version 3 does
// (strengthTable against the observer's perceived range), and version 3's response functions (respond3 / bet3)
// are averaged over the range. That is the model's predicted probability of each action, CONDITIONAL on the
// reconstructed state and the whole action history - the quantity that has to be calibrated (Phase 2.4: never
// compare a raw frequency with a constant).
//
// Each prediction is computed on a grid of calibration settings, so that a per-situation correction can be fitted
// by likelihood afterwards without recomputing ranges:
//   facing a bet or raise: fold-threshold shift SHIFTS x raise multiplier MULTS -> [fold, call, raise]
//   may bet first:          bet multiplier BETS -> P(bet)
// Cards that were not shown are never used.
// ============================================================

import { computeFeatures, NEUTRAL } from '../../../src/bot/ranges/postflop-model';
import { strengthTable } from '../../../src/bot/ranges/range-model';
import { betRole, leadSeatFor } from '../../../src/bot/strategy/spot';
import { bet3, Ctx3, defaultKnobs, Knobs, respond3 } from '../../../src/bot/strategy/v3/model';
import { buildTable, FeatureCache } from '../../../src/bot/strategy/villains';
import { HandState, legalActions, potTotal } from '../../../src/bot/table/engine';

// Grids. The first fit (shifts -0.15..0.25, raise multipliers 0.4..2) put many cells on the edges of the TRAINING
// fit (raise x2, shift -0.15), so the grids were widened toward those edges.
export const SHIFTS = [-0.3, -0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15];
export const MULTS = [0.5, 0.7, 1, 1.4, 2, 2.8, 4];
export const BETS = [0.5, 0.65, 0.8, 1, 1.2, 1.45, 1.75, 2.1, 2.6];
export const NEUTRAL_SHIFT = SHIFTS.indexOf(0), NEUTRAL_MULT = MULTS.indexOf(1), NEUTRAL_BET = BETS.indexOf(1);

export interface Pred {
  /** facing: [shift][mult][fold, call, raise], flattened (SHIFTS x MULTS x 3). open: P(bet) per BETS. */
  grid: Float32Array;
  facing: boolean;
  ctx: Ctx3;
  /** Share of the range's weight left after the line (diagnostic) and whether buildTable flagged a poor fit. */
  poorFit: boolean;
}

const one = new Map<number, Knobs>();
const knobsShift = (shift: number, mult: number): Knobs => {
  const key = shift * 1000 + mult;
  let k = one.get(key);
  if (!k) {
    const base = defaultKnobs(NEUTRAL);
    // A uniform threshold shift in every facing situation: version 3 adds raisedShift / checkRaiseShift only when
    // raised, so for a first bet the shift goes through stickiness, exactly as respond3 converts the others.
    k = { ...base, raiseMult: mult, raisedShift: 0, checkRaiseShift: 0, tend: { ...base.tend, stickiness: base.tend.stickiness - shift / 0.25 } };
    one.set(key, k);
  }
  return k;
};

/** Version 3's context for the player to act (same rules as search.ts). */
export function ctxOf(st: HandState, actor: number): Ctx3 {
  const la = legalActions(st)!;
  const pot = potTotal(st);
  const facing = la.callAmount > 1e-9;
  const evs = st.events.filter((e) => e.street === st.street && !e.kind.startsWith('post'));
  const lastAgg = st.aggressor[st.street];
  const aggChecked = lastAgg !== null && evs.some((e) => e.seat === lastAgg && e.kind === 'check');
  const acted = new Set(evs.map((e) => e.seat));
  return {
    street: st.street, betFrac: facing ? la.callAmount / Math.max(1e-9, pot - la.callAmount) : 0, level: st.raisesThisStreet,
    checkRaised: facing && aggChecked && evs.some((e) => e.seat === actor && (e.kind === 'bet' || e.kind === 'raise')),
    ownRaised: facing && evs.some((e) => e.seat === actor && (e.kind === 'bet' || e.kind === 'raise')),
    role: facing ? 'neutral' : betRole(st, actor, leadSeatFor(st, st.street), acted), canRaise: la.canRaise,
  };
}

/** Prediction for the player to act in a heads-up pot after the flop; null when not applicable. */
export function predict(st: HandState, actor: number, cache: FeatureCache): Pred | null {
  if (st.street === 'preflop' || st.board.length < 3) return null;
  const live = st.seats.filter((s) => s.dealtIn && !s.folded);
  if (live.length !== 2) return null;
  const observer = live.find((s) => s.seat !== actor)!.seat;
  const dummy: [number, number] = [st.board[0], st.board[1]];
  const t = buildTable(st, observer, dummy, new Map(), 0, cache);
  const v = t.villains.find((x) => x.seat === actor);
  if (!v) return null;
  const f = cache.get(st.board) ?? computeFeatures(st.board);
  const S = strengthTable(v.range, t.heroPerceived, f);
  const ctx = ctxOf(st, actor);
  const facing = legalActions(st)!.callAmount > 1e-9;
  let tot = 0;
  const ks: number[] = [], ws: number[] = [];
  for (let k = 0; k < 1326; k++) { const w = v.range[k]; if (w > 0 && S[k] >= 0) { ks.push(S[k]); ws.push(w); tot += w; } }
  if (tot <= 0) return null;
  if (facing) {
    const grid = new Float32Array(SHIFTS.length * MULTS.length * 3);
    SHIFTS.forEach((sh, i) => MULTS.forEach((m, j) => {
      const kn = knobsShift(sh, m);
      let pf = 0, pc = 0, pr = 0;
      for (let q = 0; q < ks.length; q++) { const r = respond3(ks[q], ctx, kn); pf += ws[q] * r.fold; pc += ws[q] * r.call; pr += ws[q] * r.raise; }
      const o = (i * MULTS.length + j) * 3;
      grid[o] = pf / tot; grid[o + 1] = pc / tot; grid[o + 2] = pr / tot;
    }));
    return { grid, facing, ctx, poorFit: v.poorFit };
  }
  const base = defaultKnobs(NEUTRAL);
  const lateStreet = st.street !== 'flop';
  const pb = new Array(ks.length);
  for (let q = 0; q < ks.length; q++) { const b = bet3(ks[q], { street: ctx.street, role: ctx.role, lateStreet }, base); pb[q] = b.small + b.large; }
  const grid = new Float32Array(BETS.length);
  BETS.forEach((m, i) => { let p = 0; for (let q = 0; q < ks.length; q++) p += ws[q] * Math.min(0.97, Math.max(0.01, pb[q] * m)); grid[i] = p / tot; });
  return { grid, facing, ctx, poorFit: v.poorFit };
}
