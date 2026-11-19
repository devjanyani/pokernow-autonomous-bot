// ============================================================
// Phase 2.5: opponent-response models fitted to real decisions, and their evaluation.
//
// Rows come from run-predict.ts (heads-up pots, with version 3's own range-conditional predictions on a grid) and
// extract.ts (all decisions, for the models that need no ranges). Four models are compared on the same rows:
//   A  hand-set: version 3's model as it is (the grid's neutral point).
//   B  frequency table: the action frequencies of each situation cell, Dirichlet-smoothed toward the street-and-type
//      parent, smoothing strength chosen on the validation days.
//   C  logistic: multinomial regression on public features, L2 strength chosen on validation.
//   D  residual-calibrated version 3: version 3's own predictions with one fold-threshold shift and one raise
//      multiplier per situation cell (facing), or one bet multiplier (may bet first), chosen by penalised likelihood
//      of the observed actions GIVEN the model's range-conditional predictions. Because the correction acts on the
//      model's prediction for the actual state and history, a high raw fold rate that the model already explains
//      (because the range that reaches the spot is weak, or the bet is large) does not move it. The Gaussian
//      penalty pulls every cell toward no correction, so a cell with little data falls back to the model.
// D is the only one that can be used inside version 3 (it stays a function of the holding's strength).
// ============================================================

import { BETS, MULTS, NEUTRAL_BET, NEUTRAL_MULT, NEUTRAL_SHIFT, SHIFTS } from './predict';

export type Split = 'train' | 'val' | 'test';
/** Chronological split by day of July 2009: 1-14 train, 15-18 validation, 19 and later test. */
export const daySplit = (day: number): Split => (day <= 14 ? 'train' : day <= 18 ? 'val' : 'test');
/** Player-grouped split: a fixed fifth of the anonymised players is held out entirely. */
export function playerGroup(player: string): number { let h = 2166136261; for (let i = 0; i < player.length; i++) { h ^= player.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 5; }

export const sizeClass = (f: number) => (f < 0.4 ? 'small' : f < 0.8 ? 'medium' : f < 1.3 ? 'large' : 'overbet');

export interface Row {
  hand: string; day: number; player: string; street: 'flop' | 'turn' | 'river'; facing: boolean;
  /** facing: 'bet' | 'raise' | 'xr' | 'cold'; open: the betting role. */
  kind: string; frac: number; ip: boolean; agg: boolean; spr: number | null; canAgg: boolean;
  /** Outcome class: facing 0 fold 1 call 2 raise; open 0 check 1 bet. */
  y: number;
  /** Version 3's predictions on the grid (predict.ts), or null for rows without ranges. */
  grid: ArrayLike<number> | null;
}

export const cellOf = (r: Pick<Row, 'street' | 'facing' | 'kind' | 'frac'>) => (r.facing ? `${r.street}|${r.kind}|${sizeClass(r.frac)}` : `${r.street}|open|${r.kind}`);
const classes = (r: Pick<Row, 'facing'>) => (r.facing ? 3 : 2);
const EPS = 1e-6;
const norm = (p: number[]) => { const t = p.reduce((a, b) => a + b, 0); return p.map((x) => x / t); };
/** Clamp and renormalise; a class that is impossible (cannot raise) gets no probability. */
export function finalize(p: number[], r: Pick<Row, 'facing' | 'canAgg'>): number[] {
  const q = p.slice();
  if (r.facing && !r.canAgg) q[2] = 0;
  if (!r.facing && !r.canAgg) q[1] = 0;
  return norm(q.map((x, i) => (r.facing && !r.canAgg && i === 2) || (!r.facing && !r.canAgg && i === 1) ? 0 : Math.max(EPS, x)));
}

// ---- A and D: version 3's predictions on the grid ----------------------------------------------------------
export function gridProbs(r: Row, si: number, mi: number): number[] {
  const g = r.grid!;
  if (r.facing) { const o = (si * MULTS.length + mi) * 3; return finalize([g[o], g[o + 1], g[o + 2]], r); }
  const pb = g[mi];
  return finalize([1 - pb, pb], r);
}
export const modelA = (r: Row) => gridProbs(r, NEUTRAL_SHIFT, r.facing ? NEUTRAL_MULT : NEUTRAL_BET);

export interface CellFit { si: number; mi: number; n: number; shift: number; mult: number }
/**
 * D: for each cell, the grid point maximising sum log p(y | grid point) - lambda * penalty, where the penalty is
 * (shift / 0.1)^2 + (log mult / log 2)^2 (facing) or (log betMult / log 2)^2 (open).
 */
export function fitResidual(rows: readonly Row[], lambda: number): Map<string, CellFit> {
  const by = new Map<string, Row[]>();
  for (const r of rows) { if (!r.grid) continue; const c = cellOf(r); if (!by.has(c)) by.set(c, []); by.get(c)!.push(r); }
  const out = new Map<string, CellFit>();
  for (const [c, rs] of by) {
    const facing = rs[0].facing;
    let best = { si: NEUTRAL_SHIFT, mi: facing ? NEUTRAL_MULT : NEUTRAL_BET, v: -Infinity };
    const SI = facing ? SHIFTS.length : 1, MI = facing ? MULTS.length : BETS.length;
    for (let si = 0; si < SI; si++) for (let mi = 0; mi < MI; mi++) {
      let ll = 0;
      for (const r of rs) ll += Math.log(gridProbs(r, facing ? si : 0, mi)[r.y]);
      const pen = facing ? (SHIFTS[si] / 0.1) ** 2 + (Math.log(MULTS[mi]) / Math.log(2)) ** 2 : (Math.log(BETS[mi]) / Math.log(2)) ** 2;
      const v = ll - lambda * pen;
      if (v > best.v) best = { si, mi, v };
    }
    out.set(c, { si: best.si, mi: best.mi, n: rs.length, shift: facing ? SHIFTS[best.si] : 0, mult: facing ? MULTS[best.mi] : BETS[best.mi] });
  }
  return out;
}
/**
 * Folding must not fall as the bet grows. Within each street and situation the fitted shifts are made non-decreasing
 * over the size classes (weighted pool-adjacent-violators by the cells' decision counts), each rounded to the grid.
 */
export function monotoneShifts(fit: Map<string, CellFit>): Map<string, CellFit> {
  const out = new Map(fit);
  const order = ['small', 'medium', 'large', 'overbet'];
  const groups = new Map<string, string[]>();
  for (const c of fit.keys()) { const [st, t, sz] = c.split('|'); if (t === 'open') continue; const g = `${st}|${t}`; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(sz); }
  for (const [g, sizes] of groups) {
    const cells = order.filter((z) => sizes.includes(z)).map((z) => ({ key: `${g}|${z}`, f: fit.get(`${g}|${z}`)! }));
    // PAV on (shift, weight n).
    const blocks: { v: number; w: number; keys: string[] }[] = [];
    for (const c of cells) {
      blocks.push({ v: c.f.shift, w: Math.max(1, c.f.n), keys: [c.key] });
      while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
        const b = blocks.pop()!, a = blocks.pop()!;
        blocks.push({ v: (a.v * a.w + b.v * b.w) / (a.w + b.w), w: a.w + b.w, keys: [...a.keys, ...b.keys] });
      }
    }
    let floor = -Infinity;
    for (const b of blocks) for (const k of b.keys) {
      let si = 0, best = Infinity; SHIFTS.forEach((x, i) => { const d = Math.abs(x - b.v); if (d < best - 1e-12 && x >= floor - 1e-12) { best = d; si = i; } });
      floor = SHIFTS[si];
      const f = out.get(k)!; out.set(k, { ...f, si, shift: SHIFTS[si] });
    }
  }
  return out;
}
export const modelD = (fit: Map<string, CellFit>) => (r: Row) => {
  const f = fit.get(cellOf(r));
  return f ? gridProbs(r, r.facing ? f.si : 0, f.mi) : modelA(r);
};

// ---- B: frequency table --------------------------------------------------------------------------------------
export function fitFrequency(rows: readonly Row[], alpha: number): (r: Row) => number[] {
  const parentKey = (r: Row) => `${r.street}|${r.facing ? 'facing' : 'open'}|${r.canAgg}`;
  const cellKey = (r: Row) => `${cellOf(r)}|${r.ip}|${r.agg}|${r.canAgg}`;
  const cnt = new Map<string, number[]>(), par = new Map<string, number[]>();
  for (const r of rows) {
    for (const [m, k] of [[cnt, cellKey(r)], [par, parentKey(r)]] as const) { if (!m.has(k)) m.set(k, new Array(classes(r)).fill(0)); m.get(k)![r.y]++; }
  }
  return (r: Row) => {
    const p0 = par.get(parentKey(r)) ?? new Array(classes(r)).fill(1);
    const pt = p0.reduce((a, b) => a + b, 0);
    const prior = p0.map((x) => (x + 1) / (pt + classes(r)));
    const c = cnt.get(cellKey(r)) ?? new Array(classes(r)).fill(0);
    const n = c.reduce((a, b) => a + b, 0);
    return finalize(c.map((x, i) => (x + alpha * prior[i]) / (n + alpha)), r);
  };
}

// ---- C: multinomial logistic regression ----------------------------------------------------------------------
function features(r: Row): number[] {
  const st = [r.street === 'flop', r.street === 'turn', r.street === 'river'].map(Number);
  const kinds = r.facing ? ['bet', 'raise', 'xr', 'cold'].map((k) => Number(r.kind === k)) : ['aggressor', 'into-aggressor', 'neutral'].map((k) => Number(r.kind === k));
  const lf = r.facing ? Math.log(Math.max(0.05, r.frac)) : 0;
  const spr = r.spr === null ? 0 : Math.log(Math.max(0.1, Math.min(50, r.spr)));
  const sprKnown = r.spr === null ? 0 : 1;
  const base = [1, ...st, ...kinds, lf, lf * lf, Number(r.ip), Number(r.agg), spr, sprKnown];
  // Street interactions with size and position.
  return [...base, ...st.map((s) => s * lf), ...st.map((s) => s * Number(r.ip)), ...st.map((s) => s * Number(r.agg))];
}
export function fitLogistic(rows: readonly Row[], l2: number, facing: boolean, iters = 300): (r: Row) => number[] {
  const rs = rows.filter((r) => r.facing === facing);
  const K = facing ? 3 : 2;
  const X = rs.map(features), D = X[0]?.length ?? 1;
  const W = Array.from({ length: K }, () => new Float64Array(D));
  const m = Array.from({ length: K }, () => new Float64Array(D)), v = Array.from({ length: K }, () => new Float64Array(D));
  const lr = 0.05, b1 = 0.9, b2 = 0.999;
  for (let it = 1; it <= iters; it++) {
    const G = Array.from({ length: K }, () => new Float64Array(D));
    for (let n = 0; n < rs.length; n++) {
      const x = X[n];
      const z = W.map((w) => w.reduce((a, wi, i) => a + wi * x[i], 0));
      if (!rs[n].canAgg) z[K - 1] = -1e9;
      const mx = Math.max(...z); const e = z.map((zz) => Math.exp(zz - mx)); const t = e.reduce((a, b) => a + b, 0);
      for (let k = 0; k < K; k++) { const g = e[k] / t - (rs[n].y === k ? 1 : 0); for (let i = 0; i < D; i++) G[k][i] += g * x[i]; }
    }
    for (let k = 0; k < K; k++) for (let i = 0; i < D; i++) {
      const g = G[k][i] / rs.length + (i === 0 ? 0 : l2 * W[k][i]);
      m[k][i] = b1 * m[k][i] + (1 - b1) * g; v[k][i] = b2 * v[k][i] + (1 - b2) * g * g;
      W[k][i] -= lr * (m[k][i] / (1 - b1 ** it)) / (Math.sqrt(v[k][i] / (1 - b2 ** it)) + 1e-8);
    }
  }
  return (r: Row) => {
    const x = features(r);
    const z = W.map((w) => w.reduce((a, wi, i) => a + wi * x[i], 0));
    const mx = Math.max(...z); const e = z.map((zz) => Math.exp(zz - mx));
    return finalize(norm(e), r);
  };
}

// ---- scores --------------------------------------------------------------------------------------------------
export interface Score { n: number; logLoss: number; brier: number; hands: number }
/** Mean log loss and Brier score; per-row values for paired comparisons. */
export function score(rows: readonly Row[], model: (r: Row) => number[]): Score & { ll: Float64Array; br: Float64Array } {
  const ll = new Float64Array(rows.length), br = new Float64Array(rows.length);
  rows.forEach((r, i) => {
    const p = model(r);
    ll[i] = -Math.log(Math.max(EPS, p[r.y]));
    br[i] = p.reduce((a, pk, k) => a + (pk - (k === r.y ? 1 : 0)) ** 2, 0);
  });
  const mean = (a: Float64Array) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return { n: rows.length, logLoss: mean(ll), brier: mean(br), hands: new Set(rows.map((r) => r.hand)).size, ll, br };
}
/** Paired difference of per-row losses (a - b), mean and 95% interval clustered by hand. */
export function pairedByHand(rows: readonly Row[], a: Float64Array, b: Float64Array): { mean: number; ci95: number } {
  const per = new Map<string, number>();
  rows.forEach((r, i) => per.set(r.hand, (per.get(r.hand) ?? 0) + a[i] - b[i]));
  const sums = [...per.values()], H = sums.length, N = rows.length;
  const mean = sums.reduce((x, y) => x + y, 0) / N;
  // Ratio estimator variance with hands as clusters.
  const sizes = new Map<string, number>(); rows.forEach((r) => sizes.set(r.hand, (sizes.get(r.hand) ?? 0) + 1));
  let s2 = 0; for (const [h, s] of per) s2 += (s - mean * sizes.get(h)!) ** 2;
  const se = Math.sqrt(s2 * H / Math.max(1, H - 1)) / N;
  return { mean, ci95: 1.96 * se };
}
/** Calibration table: mean predicted vs observed frequency of each class, per group. */
export function calibration(rows: readonly Row[], model: (r: Row) => number[], key: (r: Row) => string): { group: string; n: number; pred: number[]; obs: number[] }[] {
  const g = new Map<string, { n: number; pred: number[]; obs: number[] }>();
  for (const r of rows) {
    const k = key(r); const p = model(r);
    if (!g.has(k)) g.set(k, { n: 0, pred: new Array(p.length).fill(0), obs: new Array(p.length).fill(0) });
    const x = g.get(k)!; x.n++; p.forEach((pk, i) => { x.pred[i] += pk; }); x.obs[r.y]++;
  }
  return [...g.entries()].sort().map(([group, x]) => ({ group, n: x.n, pred: x.pred.map((v) => v / x.n), obs: x.obs.map((v) => v / x.n) }));
}
