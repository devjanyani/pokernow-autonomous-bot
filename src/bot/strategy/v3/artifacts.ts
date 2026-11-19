// ============================================================
// The fitted Phase 2.5 tables, packaged with the extension for the EXPERIMENTAL version 3 engine, and the checks
// that decide whether they may be used.
//
// Two small aggregate files sit next to this module (no hand, player or table data is in them):
//   population-calibration.json   model D of reports/PHASE_2_5_CALIBRATION.md: per situation cell a fold-threshold
//                                 shift and a raise / bet multiplier, fitted against version 3's own predictions.
//   river-range-calibration.json  the river bettor-range tilt of reports/phase25-river-range.md.
//
// Nothing is invented here. A table that is missing, malformed, from an unexpected source, outside the grid it was
// fitted on, or not monotone where the fit guaranteed monotonicity is REJECTED as a whole and version 3 uses its
// documented baseline instead (the hand-set response model, version 2's river range). The status of each table is
// reported, so the dashboard and the debug bundle can show what was used and why.
//
// Spot support (spotSupport): the tables were fitted to heads-up pots after the flop at tables of three or more
// players (heads-up TABLES were excluded from the data because of a conversion fault, see
// docs/bot/PHASE_2_5_OPPONENT_LEARNING.md), so they are not applied at a heads-up table.
// ============================================================

import populationJson from './population-calibration.json';
import riverJson from './river-range-calibration.json';
import type { PopulationCalibration, RiverRangeCalibration } from './empirical';

export type ArtifactState = 'loaded' | 'missing' | 'invalid';
export interface ArtifactStatus {
  name: 'population-calibration' | 'river-range';
  state: ArtifactState;
  /** Why it was rejected (state !== 'loaded'). */
  reason: string | null;
  /** Provenance as recorded in the file: dataset, sample, what it was fitted on. */
  source: string | null;
  fittedOn: string | null;
  cells: number;
}
export interface V3Artifacts {
  population?: PopulationCalibration;
  riverRange?: RiverRangeCalibration;
  status: ArtifactStatus[];
}

/** The dataset every packaged table must come from (pinned commit of the PHH dataset, sim/bot/data/fetch-handhq.ts). */
export const EXPECTED_SOURCE = /^phh-dataset@e47fbd5\b/;
/** The fitting grids of sim/bot/phase25/predict.ts: a value outside them was not produced by the fit. */
const SHIFT_RANGE: [number, number] = [-0.3, 0.15];
const MULT_RANGE: [number, number] = [0.5, 4];
const STREETS = ['flop', 'turn', 'river'];
const FACING = ['bet', 'cold', 'raise', 'xr'];
const SIZES = ['small', 'medium', 'large', 'overbet'];
const ROLES = ['aggressor', 'into-aggressor', 'neutral'];
const RIVER_CELLS = SIZES.flatMap((s) => [`${s}|barrel`, `${s}|no-turn-bet`]);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const within = (x: number, [lo, hi]: [number, number]) => x >= lo - 1e-9 && x <= hi + 1e-9;

type Checked<T> = { ok: true; value: T; source: string; fittedOn: string | null; cells: number } | { ok: false; reason: string; source: string | null; fittedOn: string | null };

export function validatePopulation(raw: unknown): Checked<PopulationCalibration> {
  if (raw === undefined || raw === null) return { ok: false, reason: 'file not packaged', source: null, fittedOn: null };
  if (!isObj(raw)) return { ok: false, reason: 'not a JSON object', source: null, fittedOn: null };
  const source = typeof raw.source === 'string' ? raw.source : null;
  const fittedOn = typeof raw.fittedOn === 'string' ? raw.fittedOn : null;
  const bad = (reason: string): Checked<PopulationCalibration> => ({ ok: false, reason, source, fittedOn });
  if (!source || !EXPECTED_SOURCE.test(source)) return bad(`unexpected source ${JSON.stringify(source)} (expected the pinned PHH dataset)`);
  if (!isObj(raw.cells)) return bad('no cells');
  const cells: PopulationCalibration['cells'] = {};
  for (const [key, c] of Object.entries(raw.cells)) {
    const [st, t, z, ...rest] = key.split('|');
    const known = rest.length === 0 && STREETS.includes(st) && ((t === 'open' && ROLES.includes(z)) || (FACING.includes(t) && SIZES.includes(z)));
    if (!known) return bad(`cell "${key}" is not in the feature schema version 3 uses (street|facing|size or street|open|role)`);
    if (!isObj(c) || !fin(c.shift) || !fin(c.mult) || !fin(c.n) || c.n < 0) return bad(`cell "${key}" is malformed`);
    if (!within(c.shift, SHIFT_RANGE)) return bad(`cell "${key}": shift ${c.shift} outside the fitted grid`);
    if (!within(c.mult, MULT_RANGE)) return bad(`cell "${key}": multiplier ${c.mult} outside the fitted grid`);
    if (t === 'open' && c.shift !== 0) return bad(`cell "${key}": a betting cell carries a fold shift`);
    cells[key] = { shift: c.shift, mult: c.mult, n: c.n };
  }
  const n = Object.keys(cells).length;
  if (n === 0) return bad('no cells');
  // The fit made the fold shift non-decreasing in the bet size within each street and situation (PAV); a table
  // that is not would make folding non-monotone in the size of the bet.
  for (const st of STREETS) for (const t of FACING) {
    let prev = -Infinity;
    for (const z of SIZES) {
      const c = cells[`${st}|${t}|${z}`];
      if (!c) continue;
      if (c.shift < prev - 1e-9) return bad(`${st}|${t}: fold shift decreases with the bet size`);
      prev = c.shift;
    }
  }
  return { ok: true, value: { source, cells }, source, fittedOn, cells: n };
}

export function validateRiverRange(raw: unknown): Checked<RiverRangeCalibration> {
  if (raw === undefined || raw === null) return { ok: false, reason: 'file not packaged', source: null, fittedOn: null };
  if (!isObj(raw)) return { ok: false, reason: 'not a JSON object', source: null, fittedOn: null };
  const source = typeof raw.source === 'string' ? raw.source : null;
  const fittedOn = typeof raw.fittedOn === 'string' ? raw.fittedOn : null;
  const bad = (reason: string): Checked<RiverRangeCalibration> => ({ ok: false, reason, source, fittedOn });
  if (!source || !EXPECTED_SOURCE.test(source)) return bad(`unexpected source ${JSON.stringify(source)} (expected the pinned PHH dataset)`);
  const bins = raw.bins;
  if (!Array.isArray(bins) || bins.length < 1 || !bins.every((b, i) => fin(b) && b > 0 && b < 1 && (i === 0 || b > (bins[i - 1] as number)))) return bad('bins are not increasing hand-strength edges in (0, 1)');
  if (!isObj(raw.theta)) return bad('no theta');
  const pooled = raw.pooled === true;
  const want = pooled ? ['all'] : RIVER_CELLS;
  const theta: Record<string, number[]> = {};
  for (const [key, v] of Object.entries(raw.theta)) {
    if (!want.includes(key)) return bad(`cell "${key}" is not in the feature schema (size class|turn action${pooled ? ', or "all" when pooled' : ''})`);
    if (!Array.isArray(v) || v.length !== bins.length + 1 || !v.every((x) => fin(x) && Math.abs(x) <= 3)) return bad(`cell "${key}": ${bins.length + 1} finite log-weights within ±3 expected`);
    theta[key] = v.slice() as number[];
  }
  const n = Object.keys(theta).length;
  if (n === 0) return bad('no cells');
  return { ok: true, value: { source, bins: (bins as number[]).slice(), theta, pooled }, source, fittedOn, cells: n };
}

/**
 * Validate and load the packaged tables (or the given raw objects, for tests). Each table is accepted or rejected as
 * a whole; a rejected one is simply absent from the result, with its reason in `status`.
 */
export function loadV3Artifacts(rawPopulation: unknown = populationJson, rawRiver: unknown = riverJson): V3Artifacts {
  const out: V3Artifacts = { status: [] };
  const p = validatePopulation(rawPopulation);
  if (p.ok) out.population = p.value;
  out.status.push({ name: 'population-calibration', state: p.ok ? 'loaded' : rawPopulation == null ? 'missing' : 'invalid', reason: p.ok ? null : p.reason, source: p.source, fittedOn: p.fittedOn, cells: p.ok ? p.cells : 0 });
  const r = validateRiverRange(rawRiver);
  if (r.ok) out.riverRange = r.value;
  out.status.push({ name: 'river-range', state: r.ok ? 'loaded' : rawRiver == null ? 'missing' : 'invalid', reason: r.ok ? null : r.reason, source: r.source, fittedOn: r.fittedOn, cells: r.ok ? r.cells : 0 });
  return out;
}

/** Whether the data the tables were fitted on covers this spot (both tables share the same population). */
export function spotSupport(headsUpTable: boolean): { ok: boolean; reason: string | null } {
  if (headsUpTable) return { ok: false, reason: 'heads-up table: the fitted tables come from heads-up pots at tables of three or more players (heads-up tables were excluded from the data)' };
  return { ok: true, reason: null };
}
