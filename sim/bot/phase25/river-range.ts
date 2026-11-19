// ============================================================
// Phase 2.5: an experimental estimator of a river bettor's range, fitted to revealed hands.
//
// Base: version 2's range estimate for the bettor after the bet (buildTable: preflop range, the line on every
// street, board texture, bet sizes through the behaviour model, position; the caller's cards removed when they were
// shown, which accounts for card removal / blockers).
// Estimator: the base range tilted by exp(theta[cell][bin]) for each holding, where bin = the holding's made-hand
// percentile on the river board (6 bins) and cell = bet size class x whether the bettor also bet the turn. theta is
// fitted by penalised maximum likelihood (Gaussian prior, sd = 1/sqrt(2*l2)) of the bettor's REVEALED holding in
// called river bets on the training days.
//
// Selection: only called bets are revealed. The caller decides without seeing the bettor's cards, so given the
// public state the revealed holdings are a sample of the betting range, apart from card removal by the caller's own
// cards (removed when known) and the 0.2% of called bettors who did not show. Bets that were not called are not in
// the sample; nothing is inferred about them beyond what the conditioning on size and line carries.
// "Value", "thin value" and "bluff" are strength categories of the hypothesised range, not facts about any hand.
// ============================================================

import { comboIndex, parseCardStrict } from '../../../src/bot/cards';
import { computeFeatures } from '../../../src/bot/ranges/postflop-model';
import type { Range } from '../../../src/bot/ranges/range';

export const HS_BINS = [0.2, 0.4, 0.6, 0.75, 0.9];   // bin edges of the made-hand percentile -> 6 bins
export const binOf = (hs: number) => { let b = 0; while (b < HS_BINS.length && hs >= HS_BINS[b]) b++; return b; };
export const riverCell = (frac: number, betTurn: boolean) => `${frac < 0.4 ? 'small' : frac < 0.8 ? 'medium' : frac < 1.3 ? 'large' : 'overbet'}|${betTurn ? 'barrel' : 'no-turn-bet'}`;
export const CATEGORY = (hs: number) => (hs >= 0.75 ? 'value' : hs >= 0.4 ? 'thin / medium' : 'bluff (weak)');

export interface RiverObs {
  hand: string; day: number;
  /** Base range weights (version 2) for the bettor, card-removed; the revealed holding's index; percentile per combo. */
  range: Float64Array; combo: number; hs: Float32Array; cell: string;
}

/** Per-combo made-hand percentile on a river board (computeFeatures hs; -1 for impossible combos). */
export function riverPercentiles(board: number[]): Float32Array { return computeFeatures(board).hs as unknown as Float32Array; }

export interface RiverModel { theta: Record<string, number[]>; l2: number }

export function tilt(range: Range, hs: Float32Array, th: number[] | undefined): Float64Array {
  const out = new Float64Array(1326);
  for (let k = 0; k < 1326; k++) { const w = range[k]; if (w > 0 && hs[k] >= 0) out[k] = w * (th ? Math.exp(th[binOf(hs[k])]) : 1); }
  return out;
}
export function logLik(o: RiverObs, th: number[] | undefined): number {
  const w = tilt(o.range, o.hs, th);
  let t = 0; for (let k = 0; k < 1326; k++) t += w[k];
  return t > 0 && w[o.combo] > 0 ? Math.log(w[o.combo] / t) : Math.log(1e-6);
}

/** Penalised ML fit of theta per cell by gradient ascent. */
export function fitRiver(obs: readonly RiverObs[], l2: number, iters = 400): RiverModel {
  const B = HS_BINS.length + 1;
  const by = new Map<string, RiverObs[]>();
  for (const o of obs) { if (!by.has(o.cell)) by.set(o.cell, []); by.get(o.cell)!.push(o); }
  const theta: Record<string, number[]> = {};
  for (const [c, os] of by) {
    // Bin masses per observation (base weights), so each iteration is O(obs x bins).
    const mass = os.map((o) => { const m = new Float64Array(B); for (let k = 0; k < 1326; k++) if (o.range[k] > 0 && o.hs[k] >= 0) m[binOf(o.hs[k])] += o.range[k]; return m; });
    const yb = os.map((o) => binOf(o.hs[o.combo]));
    const th = new Array(B).fill(0);
    for (let it = 0; it < iters; it++) {
      const g = new Array(B).fill(0);
      os.forEach((_, n) => {
        const e = th.map((t, b) => mass[n][b] * Math.exp(t)); const tot = e.reduce((a, b) => a + b, 0);
        for (let b = 0; b < B; b++) g[b] -= e[b] / tot;
        g[yb[n]] += 1;
      });
      for (let b = 0; b < B; b++) th[b] += (0.5 / Math.max(1, os.length)) * (g[b] - 2 * l2 * th[b]);
      const m = th.reduce((a, b) => a + b, 0) / B; for (let b = 0; b < B; b++) th[b] -= m;   // identifiable: mean 0
    }
    theta[c] = th;
  }
  return { theta, l2 };
}

/** Share of the (tilted) range in each strength category. */
export function categories(o: RiverObs, th: number[] | undefined): Record<string, number> {
  const w = tilt(o.range, o.hs, th);
  const out: Record<string, number> = { value: 0, 'thin / medium': 0, 'bluff (weak)': 0 };
  let t = 0; for (let k = 0; k < 1326; k++) if (w[k] > 0) { out[CATEGORY(o.hs[k])] += w[k]; t += w[k]; }
  for (const k of Object.keys(out)) out[k] /= t || 1;
  return out;
}

export const comboOf = (s: string) => comboIndex(parseCardStrict(s.slice(0, 2)) as number, parseCardStrict(s.slice(2, 4)) as number);
