// ============================================================
// Range representation: 1326 combo weights (Float64Array indexed by
// comboIndex) plus the 169-class strength ordering used for "top X%" bands.
//
// SOURCE OF THE ORDERING (computed, not solved): PREFLOP_STRENGTH is generated
// by src/solver/preflop/build-strength.ts as 0.5 * all-in equity vs a random
// hand + 0.5 * all-in equity vs the top 20%. It is an equity ordering, not a
// playability ordering, so percentile bands built from it are approximations.
// ============================================================

import { CardId, COMBO_HI, COMBO_LO, NUM_COMBOS, handClass } from '../cards';
import { PREFLOP_STRENGTH } from '../../core/ranges/preflop-strength';
import type { WeightedRange } from '../../core/ranges/weighted-range';

export type Range = Float64Array;

export interface ClassInfo { name: string; score: number; combos: number; /** Fraction of all hands strictly stronger. */ start: number; /** start + own fraction. */ end: number }

export const CLASS_ORDER: ClassInfo[] = (() => {
  const list = Object.entries(PREFLOP_STRENGTH)
    .map(([name, score]) => ({ name, score, combos: name.length === 2 ? 6 : name.endsWith('s') ? 4 : 12, start: 0, end: 0 }))
    .sort((a, b) => b.score - a.score);
  if (list.length !== 169) throw new Error(`expected 169 hand classes, got ${list.length}`);
  let acc = 0;
  for (const c of list) { c.start = acc / NUM_COMBOS; acc += c.combos; c.end = acc / NUM_COMBOS; }
  return list;
})();

export const CLASS_BY_NAME: Map<string, ClassInfo> = new Map(CLASS_ORDER.map((c) => [c.name, c]));

/** Class name for every combo index. */
export const COMBO_CLASS: string[] = (() => {
  const out: string[] = [];
  for (let k = 0; k < NUM_COMBOS; k++) out.push(handClass(COMBO_LO[k], COMBO_HI[k]));
  return out;
})();

/** Percentile (0 = best) of the middle of a hand class. */
export function classPercentile(name: string): number {
  const c = CLASS_BY_NAME.get(name);
  return c ? (c.start + c.end) / 2 : 1;
}

export const emptyRange = (): Range => new Float64Array(NUM_COMBOS);
export const fullRange = (): Range => new Float64Array(NUM_COMBOS).fill(1);

/** Build a range from a per-class weight function. */
export function rangeFromClassWeights(weight: (c: ClassInfo) => number): Range {
  const byName = new Map<string, number>();
  for (const c of CLASS_ORDER) byName.set(c.name, Math.max(0, weight(c)));
  const r = emptyRange();
  for (let k = 0; k < NUM_COMBOS; k++) r[k] = byName.get(COMBO_CLASS[k]) ?? 0;
  return r;
}

/** Weight of a class inside the percentile band [lo, hi): fractional at the edges. */
export function bandWeight(c: ClassInfo, lo: number, hi: number): number {
  const overlap = Math.min(c.end, hi) - Math.max(c.start, lo);
  return overlap <= 0 ? 0 : Math.min(1, overlap / (c.end - c.start));
}

export interface Band { lo: number; hi: number; w: number }

/** Sum of weighted percentile bands (weights are capped at 1 per class). */
export function rangeFromBands(bands: Band[]): Range {
  return rangeFromClassWeights((c) => {
    let w = 0;
    for (const b of bands) w += b.w * bandWeight(c, b.lo, b.hi);
    return Math.min(1, w);
  });
}

export const topRange = (frac: number): Range => rangeFromBands([{ lo: 0, hi: Math.max(0.004, Math.min(1, frac)), w: 1 }]);

/** Range from a set of class names (e.g. a chart's "in range" cells) with optional weights. */
export function rangeFromClasses(weights: Map<string, number> | Iterable<string>): Range {
  const m = weights instanceof Map ? weights : new Map([...weights].map((n) => [n, 1] as [string, number]));
  return rangeFromClassWeights((c) => m.get(c.name) ?? 0);
}

export function rangeTotal(r: Range): number {
  let t = 0;
  for (let k = 0; k < NUM_COMBOS; k++) t += r[k];
  return t;
}

/** Fraction of all 1326 combos (weight-adjusted) contained in the range. */
export const rangeFraction = (r: Range): number => rangeTotal(r) / NUM_COMBOS;

export function removeDead(r: Range, dead: readonly CardId[]): Range {
  const out = new Float64Array(r);
  const isDead = new Uint8Array(52);
  for (const c of dead) isDead[c] = 1;
  for (let k = 0; k < NUM_COMBOS; k++) if (isDead[COMBO_LO[k]] || isDead[COMBO_HI[k]]) out[k] = 0;
  return out;
}

export function multiplyInto(r: Range, f: (comboIdx: number) => number): void {
  for (let k = 0; k < NUM_COMBOS; k++) if (r[k] > 0) r[k] *= f(k);
}

/**
 * Convert to the sampler's WeightedRange, dropping dead cards. If the range is
 * empty after card removal the caller gets `empty: true` and a uniform any-two
 * range, so an inconsistent read can never produce "no opponents".
 */
export function toWeighted(r: Range, dead: readonly CardId[]): { range: WeightedRange; idx: Int16Array; empty: boolean } {
  const isDead = new Uint8Array(52);
  for (const c of dead) isDead[c] = 1;
  const build = (src: Range | null) => {
    const combos: [CardId, CardId][] = [];
    const weights: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k < NUM_COMBOS; k++) {
      const w = src ? src[k] : 1;
      if (!(w > 1e-9) || isDead[COMBO_LO[k]] || isDead[COMBO_HI[k]]) continue;
      combos.push([COMBO_LO[k], COMBO_HI[k]]);
      weights.push(w);
      idx.push(k);
    }
    return { range: { combos, weights }, idx: Int16Array.from(idx) };
  };
  const a = build(r);
  if (a.idx.length > 0) return { ...a, empty: false };
  return { ...build(null), empty: true };
}

/** Human-readable summary: range size and the strongest classes with weight. */
export function describeRange(r: Range, maxClasses = 12): string {
  const total = rangeTotal(r);
  if (total <= 0) return 'empty';
  const byClass = new Map<string, number>();
  for (let k = 0; k < NUM_COMBOS; k++) if (r[k] > 0) byClass.set(COMBO_CLASS[k], (byClass.get(COMBO_CLASS[k]) ?? 0) + r[k]);
  const top = [...byClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxClasses).map(([n]) => n);
  return `${(100 * total / NUM_COMBOS).toFixed(1)}% of hands; heaviest: ${top.join(' ')}`;
}
