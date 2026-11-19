// ============================================================
// Phase 2.5: empirical corrections for the EXPERIMENTAL version 3 engine (offline only; the extension never
// passes them, so production behaviour is unchanged).
//
// 1. Population calibration of opponent responses. Fitted offline (sim/bot/phase25/calibrate.ts, model D) to real
//    cash-game hands: for each situation cell (street, what the player faces, bet-size class) a shift of the fold
//    threshold and a multiplier on raising; for players who may bet first, a multiplier on betting. They were fitted
//    against version 3's OWN range-conditional predictions for the real states, so they correct the model's
//    residual error only and never count range selection a second time (the Phase 2.4 defect). Within a street and
//    situation the shift and multiplier are interpolated over the bet size (log scale) between the centres of the
//    size classes, so that folding stays monotone in the size of the bet.
// 2. River betting-range tilt. Fitted offline (sim/bot/phase25/river-eval.ts) to revealed holdings of called river
//    bets: a log-weight per made-hand-percentile bin, per bet-size class and turn action of the bettor, applied to
//    version 2's range estimate of the bettor when Hero faces a river bet.
// Both are data loaded by the caller (JSON next to this file); nothing here reads files.
// ============================================================

import type { Range } from '../../ranges/range';
import type { Ctx3 } from './model';

export interface PopulationCalibration {
  source: string;
  cells: Record<string, { shift: number; mult: number; n: number }>;
}
export interface RiverRangeCalibration {
  source: string;
  bins: number[];
  theta: Record<string, number[]>;
  pooled?: boolean;
}

const SIZE_CENTRES: [string, number][] = [['small', 0.25], ['medium', 0.6], ['large', 1.0], ['overbet', 1.8]];
export const facingType = (c: Pick<Ctx3, 'level' | 'ownRaised' | 'checkRaised'>) => (c.level <= 1 ? 'bet' : !c.ownRaised ? 'cold' : c.checkRaised ? 'xr' : 'raise');

/** Shift and raise multiplier for a player facing a bet in context c (no correction when the cells are missing). */
export function facingCorrection(p: PopulationCalibration, c: Ctx3): { shift: number; mult: number } {
  const t = facingType(c);
  const pts = SIZE_CENTRES.map(([cls, x]) => ({ x: Math.log(x), cell: p.cells[`${c.street}|${t}|${cls}`] })).filter((q) => q.cell);
  if (!pts.length) return { shift: 0, mult: 1 };
  const lx = Math.log(Math.max(0.05, c.betFrac));
  if (lx <= pts[0].x) return { shift: pts[0].cell.shift, mult: pts[0].cell.mult };
  const last = pts[pts.length - 1];
  if (lx >= last.x) return { shift: last.cell.shift, mult: last.cell.mult };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (lx >= a.x && lx <= b.x) {
      const u = (lx - a.x) / (b.x - a.x);
      return { shift: a.cell.shift + u * (b.cell.shift - a.cell.shift), mult: Math.exp(Math.log(a.cell.mult) + u * (Math.log(b.cell.mult) - Math.log(a.cell.mult))) };
    }
  }
  return { shift: 0, mult: 1 };
}
/** Multiplier on the probability of betting for a player who may bet first. */
export const openCorrection = (p: PopulationCalibration, street: string, role: string): number => p.cells[`${street}|open|${role}`]?.mult ?? 1;

export const riverCellOf = (frac: number, betTurn: boolean) => `${frac < 0.4 ? 'small' : frac < 0.8 ? 'medium' : frac < 1.3 ? 'large' : 'overbet'}|${betTurn ? 'barrel' : 'no-turn-bet'}`;

/** The bettor's range tilted by the fitted log-weights (hs = made-hand percentile per combo on the river board). */
export function tiltRiverRange(r: RiverRangeCalibration, range: Range, hs: ArrayLike<number>, frac: number, betTurn: boolean): { range: Float64Array; cell: string } {
  const cell = r.pooled ? 'all' : riverCellOf(frac, betTurn);
  const th = r.theta[cell];
  const out = new Float64Array(range.length);
  for (let k = 0; k < range.length; k++) {
    const w = range[k];
    if (!(w > 0) || hs[k] < 0) { out[k] = w > 0 ? w : 0; continue; }
    if (!th) { out[k] = w; continue; }
    let b = 0; while (b < r.bins.length && hs[k] >= r.bins[b]) b++;
    out[k] = w * Math.exp(th[b]);
  }
  return { range: out, cell };
}
