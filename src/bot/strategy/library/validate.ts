// ============================================================
// Validation of strategy packs. A pack with any error is never registered.
// ============================================================

import { RANK_CHARS, SUIT_CHARS } from '../../cards';
import { HandMix, MixAction, PACK_FORMAT, PACK_VERSION, PackIssue, PreflopSpot, SCENARIOS, StrategyPack } from './types';

const ACTIONS: readonly MixAction[] = ['fold', 'call', 'raise', 'allin'];
const NEEDS_VILLAIN = new Set(['vs-open', 'vs-open-call', 'vs-3bet', 'vs-squeeze', 'vs-4bet']);

/** "AKs", "77", "T9o" with the higher rank first; null when malformed. */
export function normaliseClass(key: string): string | null {
  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/.exec(key.trim());
  if (!m) return null;
  const a = RANK_CHARS.indexOf(m[1]), b = RANK_CHARS.indexOf(m[2]);
  if (a === b) return m[3] === '' ? m[1] + m[2] : null;
  if (m[3] === '') return null;
  return a > b ? m[1] + m[2] + m[3] : m[2] + m[1] + m[3];
}

/** "AhKh" -> canonical combo key with the higher card first, plus its class; null when malformed. */
export function normaliseCombo(key: string): { combo: string; cls: string } | null {
  const m = /^([2-9TJQKA])([hdcs])([2-9TJQKA])([hdcs])$/.exec(key.trim());
  if (!m) return null;
  const r1 = RANK_CHARS.indexOf(m[1]), r2 = RANK_CHARS.indexOf(m[3]);
  if (r1 === r2 && m[2] === m[4]) return null;
  const firstHigh = r1 > r2 || (r1 === r2 && SUIT_CHARS.indexOf(m[2]) < SUIT_CHARS.indexOf(m[4]));
  const [a, b] = firstHigh ? [m[1] + m[2], m[3] + m[4]] : [m[3] + m[4], m[1] + m[2]];
  const cls = r1 === r2 ? a[0] + b[0] : a[0] + b[0] + (m[2] === m[4] ? 's' : 'o');
  return { combo: a + b, cls };
}

function checkMix(mix: HandMix, where: string, out: PackIssue[]): void {
  let sum = 0;
  for (const [k, v] of Object.entries(mix)) {
    if (!ACTIONS.includes(k as MixAction)) { out.push({ level: 'error', where, message: `unknown action "${k}"` }); continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1 + 1e-9) { out.push({ level: 'error', where, message: `frequency for ${k} must be a number from 0 to 1, got ${String(v)}` }); continue; }
    sum += v;
  }
  if (sum > 1 + 1e-6) out.push({ level: 'error', where, message: `frequencies sum to ${sum.toFixed(4)}, more than 1` });
}

function checkSpot(sp: PreflopSpot, pack: StrategyPack, out: PackIssue[]): void {
  const where = `spot ${sp.id}`;
  if (!SCENARIOS.includes(sp.scenario)) out.push({ level: 'error', where, message: `unknown scenario "${sp.scenario}"` });
  if (!pack.positions.includes(sp.hero)) out.push({ level: 'error', where, message: `hero position "${sp.hero}" is not one of the pack's positions` });
  if (sp.villain !== undefined && !pack.positions.includes(sp.villain)) out.push({ level: 'error', where, message: `villain position "${sp.villain}" is not one of the pack's positions` });
  if (NEEDS_VILLAIN.has(sp.scenario) && sp.villain === undefined) out.push({ level: 'error', where, message: `scenario ${sp.scenario} needs a villain position` });
  if (sp.villain !== undefined && sp.villain === sp.hero) out.push({ level: 'error', where, message: 'hero and villain are the same position' });
  if (sp.stackBB && !(sp.stackBB[0] > 0 && sp.stackBB[1] >= sp.stackBB[0])) out.push({ level: 'error', where, message: 'stackBB must be [min, max] with 0 < min <= max' });
  if (!sp.hands || typeof sp.hands !== 'object' || Object.keys(sp.hands).length === 0) { out.push({ level: 'error', where, message: 'no hands' }); return; }
  const seen = new Set<string>();
  for (const [key, mix] of Object.entries(sp.hands)) {
    const cls = normaliseClass(key), combo = cls ? null : normaliseCombo(key);
    if (!cls && !combo) { out.push({ level: 'error', where, message: `"${key}" is neither a hand class (AKs, 77, T9o) nor a combo (AhKh)` }); continue; }
    const canon = cls ?? combo!.combo;
    if (seen.has(canon)) out.push({ level: 'error', where, message: `hand ${canon} appears twice` });
    seen.add(canon);
    checkMix(mix, `${where} ${key}`, out);
  }
  const playable = Object.values(sp.hands).reduce((a, m) => a + ((m.call ?? 0) + (m.raise ?? 0) + (m.allin ?? 0) > 0 ? 1 : 0), 0);
  if (playable === 0) out.push({ level: 'warning', where, message: 'every listed hand folds' });
}

export function validatePack(p: unknown): PackIssue[] {
  const out: PackIssue[] = [];
  const err = (where: string, message: string) => { out.push({ level: 'error', where, message }); };
  if (!p || typeof p !== 'object') { err('pack', 'not an object'); return out; }
  const pack = p as StrategyPack;
  if (pack.format !== PACK_FORMAT) err('pack', `format must be "${PACK_FORMAT}"`);
  if (pack.version !== PACK_VERSION) err('pack', `version must be ${PACK_VERSION}`);
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(pack.id ?? '')) err('pack', 'id must be 2-64 characters: lower-case letters, digits, dot, dash, underscore');
  if (!pack.name) err('pack', 'name is missing');
  if (!pack.revision) err('pack', 'revision is missing');

  const src = pack.source;
  if (!src || !['solver', 'chart', 'calculated', 'heuristic'].includes(src.kind)) err('source', 'source.kind must be solver, chart, calculated or heuristic');
  else {
    if (typeof src.verified !== 'boolean') err('source', 'source.verified must be true or false');
    if ((src.kind === 'solver' || src.kind === 'chart') && !src.license) err('source', `a ${src.kind} pack must state the licence or permission it is used under (source.license)`);
    if (src.kind === 'solver' && !src.tool) err('source', 'a solver pack must name the solver (source.tool)');
    if (src.verified === false) out.push({ level: 'warning', where: 'source', message: 'source is not verified; decisions from this pack are labelled "unverified"' });
  }

  const a = pack.assumptions;
  if (!a) err('assumptions', 'missing');
  else {
    if (a.format !== 'cash' && a.format !== 'tournament') err('assumptions', 'format must be cash or tournament');
    if (!Number.isInteger(a.players) || a.players < 2 || a.players > 10) err('assumptions', 'players must be 2-10');
    if (!Array.isArray(a.stackBB) || !(a.stackBB[0] > 0 && a.stackBB[1] >= a.stackBB[0])) err('assumptions', 'stackBB must be [min, max] with 0 < min <= max');
  }
  if (!Array.isArray(pack.positions) || (a && pack.positions.length !== a.players)) err('positions', 'positions must list one name per player, first to act first');
  else if (new Set(pack.positions).size !== pack.positions.length) err('positions', 'position names must be distinct');
  if (!Array.isArray(pack.spots)) { err('spots', 'missing'); return out; }
  if (out.some((i) => i.level === 'error')) return out;

  const ids = new Set<string>();
  for (const sp of pack.spots) {
    if (!sp.id) { err('spots', 'a spot has no id'); continue; }
    if (ids.has(sp.id)) err(`spot ${sp.id}`, 'duplicate spot id');
    ids.add(sp.id);
    checkSpot(sp, pack, out);
  }
  for (const r of pack.references ?? []) {
    const sum = Object.values(r.frequencies ?? {}).reduce((x, y) => x + y, 0);
    if (!r.scenario) err('references', 'a reference has no scenario id');
    if (Math.abs(sum - 1) > 0.02) err(`reference ${r.scenario}`, `frequencies sum to ${sum.toFixed(3)}, expected 1`);
    if (!r.setup) err(`reference ${r.scenario}`, 'setup (ranges, sizes) is missing');
  }
  for (const pr of pack.principles ?? []) if (!pr.id || !pr.statement || !pr.source) err('principles', `principle ${pr.id ?? '?'} needs id, statement and source`);
  return out;
}

export const packErrors = (issues: PackIssue[]): PackIssue[] => issues.filter((i) => i.level === 'error');
