// ============================================================
// Importers for strategy packs. Three input formats:
//
//   1. JSON   the native pack format (library/types.ts)
//   2. TEXT   a readable range file:
//
//        @pack id=my-6max name="My 6-max ranges" revision=1
//        @source kind=solver tool="<solver name>" license="own solve" verified=yes
//        @assume format=cash players=6 stack=80-120 ante=0 open=2.5
//        @positions UTG MP CO BTN SB BB
//
//        @spot rfi hero=UTG
//        raise: 66+, ATs+, KTs+, QTs+, JTs, AQo+, A5s:0.5
//
//        @spot vs-open hero=BB villain=BTN
//        raise: QQ+, AKs, A5s:0.4
//        call:  22-JJ, A2s+, K9s-K2s, AhKd:0.5
//
//      Range syntax: pairs "77", "77+", "77-44"; "ATs+", "K9s-K6s" (same high
//      card), "98s-65s" (connectors of one gap); "AK" = suited and offsuit;
//      exact combos "AhKd"; a weight after a colon, 0-1 or a percentage.
//
//   3. CSV    one row per hand and spot, header required:
//        scenario,hero,villain,callers,limpers,hand,fold,call,raise,allin
//      with the pack header given as "#@pack ..." comment lines (same
//      directives as the text format).
//
// Unknown tokens are errors, never ignored. The importer does not invent
// frequencies: a hand that is not listed folds.
// ============================================================

import { RANK_CHARS } from '../../cards';
import { MixAction, PACK_FORMAT, PACK_VERSION, PackIssue, PreflopScenario, PreflopSpot, StrategyPack } from './types';
import { normaliseClass, normaliseCombo, validatePack } from './validate';

export class ImportError extends Error {
  constructor(message: string, readonly line: number) { super(`line ${line}: ${message}`); this.name = 'ImportError'; }
}

const R = RANK_CHARS;
const rv = (c: string) => R.indexOf(c);
const cls = (hi: number, lo: number, s: 's' | 'o') => R[Math.max(hi, lo)] + R[Math.min(hi, lo)] + s;

/** Expand one range token to hand classes or one combo. Throws on anything it does not understand. */
export function expandToken(tok: string): string[] {
  const t = tok.trim();
  let m: RegExpExecArray | null;
  if ((m = /^([2-9TJQKA])\1$/.exec(t))) return [t];
  if ((m = /^([2-9TJQKA])\1\+$/.exec(t))) { const out = []; for (let v = rv(m[1]); v <= 12; v++) out.push(R[v] + R[v]); return out; }
  if ((m = /^([2-9TJQKA])\1-([2-9TJQKA])\2$/.exec(t))) {
    const a = rv(m[1]), b = rv(m[2]), out = [];
    for (let v = Math.min(a, b); v <= Math.max(a, b); v++) out.push(R[v] + R[v]);
    return out;
  }
  if ((m = /^([2-9TJQKA])([2-9TJQKA])([so])?(\+)?$/.exec(t))) {
    const hi = Math.max(rv(m[1]), rv(m[2])), lo = Math.min(rv(m[1]), rv(m[2]));
    if (hi === lo) throw new Error(`"${t}" is not a valid hand`);
    const suits: ('s' | 'o')[] = m[3] ? [m[3] as 's' | 'o'] : ['s', 'o'];
    const out: string[] = [];
    for (const s of suits) for (let k = lo; k <= (m[4] ? hi - 1 : lo); k++) out.push(cls(hi, k, s));
    return out;
  }
  if ((m = /^([2-9TJQKA])([2-9TJQKA])([so])-([2-9TJQKA])([2-9TJQKA])\3$/.exec(t))) {
    const h1 = rv(m[1]), l1 = rv(m[2]), h2 = rv(m[4]), l2 = rv(m[5]), s = m[3] as 's' | 'o';
    if (h1 <= l1 || h2 <= l2) throw new Error(`"${t}": write the higher card first`);
    const out: string[] = [];
    if (h1 === h2) { for (let k = Math.min(l1, l2); k <= Math.max(l1, l2); k++) out.push(cls(h1, k, s)); return out; }
    if (h1 - l1 !== h2 - l2) throw new Error(`"${t}": a dash range needs the same high card or the same gap`);
    for (let h = Math.min(h1, h2); h <= Math.max(h1, h2); h++) out.push(cls(h, h - (h1 - l1), s));
    return out;
  }
  const combo = normaliseCombo(t);
  if (combo) return [combo.combo];
  throw new Error(`cannot read range token "${t}"`);
}

function parseWeight(w: string | undefined): number {
  if (w === undefined) return 1;
  const pct = w.endsWith('%');
  const x = Number(pct ? w.slice(0, -1) : w);
  if (!Number.isFinite(x)) throw new Error(`bad weight "${w}"`);
  const f = pct ? x / 100 : x;
  if (f < 0 || f > 1) throw new Error(`weight ${w} is outside 0-1`);
  return f;
}

/** Parse "66+, ATs+, A5s:0.5" into hand -> weight. A hand listed twice in one list is an error. */
export function parseRangeList(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of text.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [tok, w] = raw.split(':');
    const weight = parseWeight(w?.trim());
    for (const h of expandToken(tok)) {
      if (out.has(h)) throw new Error(`${h} is listed twice`);
      out.set(h, weight);
    }
  }
  return out;
}

/** key=value pairs; values may be quoted. */
function kv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z]+)=("([^"]*)"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1].toLowerCase()] = m[3] ?? m[2];
  return out;
}

const yes = (s: string | undefined) => /^(yes|true|1)$/i.test(s ?? '');
function range2(s: string | undefined, d: [number, number]): [number, number] {
  if (!s) return d;
  const p = s.split('-').map(Number);
  return p.length === 2 ? [p[0], p[1]] : [p[0], p[0]];
}

function applyDirective(pack: StrategyPack, name: string, rest: string, line: number): PreflopSpot | null {
  const a = kv(rest);
  switch (name) {
    case 'pack': pack.id = a.id ?? pack.id; pack.name = a.name ?? pack.name; pack.revision = a.revision ?? pack.revision; return null;
    case 'source':
      pack.source = { kind: (a.kind ?? 'heuristic') as StrategyPack['source']['kind'], tool: a.tool, author: a.author, license: a.license, url: a.url, obtained: a.obtained, notes: a.notes, verified: yes(a.verified) };
      return null;
    case 'assume':
      pack.assumptions = {
        format: (a.format ?? 'cash') as 'cash' | 'tournament', players: Number(a.players ?? pack.assumptions.players),
        stackBB: range2(a.stack, pack.assumptions.stackBB), anteBB: a.ante ? Number(a.ante) : 0, rake: a.rake, openSizeBB: a.open ? Number(a.open) : undefined, notes: a.notes,
      };
      return null;
    case 'positions': pack.positions = rest.trim().split(/\s+/).filter(Boolean); return null;
    case 'spot': {
      const scenario = rest.trim().split(/\s+/)[0] as PreflopScenario;
      if (!a.hero) throw new ImportError('@spot needs hero=<position>', line);
      const id = a.id ?? [a.hero, scenario, a.villain, a.callers && `${a.callers}c`, a.limpers && `${a.limpers}l`, a.stack && `${a.stack}bb`].filter(Boolean).join('-');
      const spot: PreflopSpot = { id, scenario, hero: a.hero, hands: {} };
      if (a.villain) spot.villain = a.villain;
      if (a.callers) spot.callers = Number(a.callers);
      if (a.limpers) spot.limpers = Number(a.limpers);
      if (a.stack) spot.stackBB = range2(a.stack, [0, 0]);
      if (a.raiseto) spot.sizing = { raiseToBB: Number(a.raiseto) };
      if (a.raisemult) spot.sizing = { ...spot.sizing, raiseMult: Number(a.raisemult) };
      pack.spots.push(spot);
      return spot;
    }
    default: throw new ImportError(`unknown directive @${name}`, line);
  }
}

const blankPack = (): StrategyPack => ({
  format: PACK_FORMAT, version: PACK_VERSION, id: '', name: '', revision: '1',
  source: { kind: 'heuristic', verified: false }, assumptions: { format: 'cash', players: 6, stackBB: [80, 120] }, positions: [], spots: [],
});

function addHand(spot: PreflopSpot, hand: string, action: MixAction, f: number, line: number): void {
  const mix = (spot.hands[hand] ??= {});
  if (mix[action] !== undefined) throw new ImportError(`${hand} already has a ${action} frequency in spot ${spot.id}`, line);
  if (action !== 'fold' && f > 0) mix[action] = f;
  else if (action === 'fold') mix.fold = f;
}

export function parseTextPack(text: string): StrategyPack {
  const pack = blankPack();
  let spot: PreflopSpot | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('@')) {
      const m = /^@(\w+)\s*(.*)$/.exec(line)!;
      const s = applyDirective(pack, m[1].toLowerCase(), m[2], i + 1);
      if (m[1].toLowerCase() === 'spot') spot = s;
      continue;
    }
    const m = /^(fold|call|raise|allin)\s*:\s*(.*)$/i.exec(line);
    if (!m) throw new ImportError(`expected a directive or "action: range", got "${line.slice(0, 40)}"`, i + 1);
    if (!spot) throw new ImportError('a range line appears before any @spot', i + 1);
    let list: Map<string, number>;
    try { list = parseRangeList(m[2]); } catch (e) { throw new ImportError((e as Error).message, i + 1); }
    for (const [hand, f] of list) addHand(spot, hand, m[1].toLowerCase() as MixAction, f, i + 1);
  }
  return finish(pack);
}

export function parseCsvPack(text: string): StrategyPack {
  const pack = blankPack();
  const lines = text.split(/\r?\n/);
  let header: string[] | null = null;
  const spots = new Map<string, PreflopSpot>();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (raw.startsWith('#')) {
      const m = /^#\s*@(\w+)\s*(.*)$/.exec(raw);
      if (m && m[1].toLowerCase() !== 'spot') applyDirective(pack, m[1].toLowerCase(), m[2], i + 1);
      continue;
    }
    const cells = raw.split(',').map((c) => c.trim());
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      for (const need of ['scenario', 'hero', 'hand']) if (!header.includes(need)) throw new ImportError(`CSV header needs a "${need}" column`, i + 1);
      continue;
    }
    const get = (k: string) => { const j = header!.indexOf(k); return j >= 0 ? cells[j] ?? '' : ''; };
    const key = ['scenario', 'hero', 'villain', 'callers', 'limpers'].map(get).join('|');
    let spot = spots.get(key);
    if (!spot) {
      spot = { id: [get('hero'), get('scenario'), get('villain'), get('callers') && `${get('callers')}c`, get('limpers') && `${get('limpers')}l`].filter(Boolean).join('-'), scenario: get('scenario') as PreflopScenario, hero: get('hero'), hands: {} };
      if (get('villain')) spot.villain = get('villain');
      if (get('callers')) spot.callers = Number(get('callers'));
      if (get('limpers')) spot.limpers = Number(get('limpers'));
      spots.set(key, spot);
      pack.spots.push(spot);
    }
    const hand = normaliseClass(get('hand')) ?? normaliseCombo(get('hand'))?.combo;
    if (!hand) throw new ImportError(`"${get('hand')}" is not a hand class or combo`, i + 1);
    for (const a of ['fold', 'call', 'raise', 'allin'] as MixAction[]) {
      const v = get(a);
      if (v === '') continue;
      let f: number;
      try { f = parseWeight(v); } catch (e) { throw new ImportError((e as Error).message, i + 1); }
      addHand(spot, hand, a, f, i + 1);
    }
  }
  return finish(pack);
}

function finish(pack: StrategyPack): StrategyPack {
  // An explicit fold frequency is only a check on the row; the stored mix keeps the non-fold actions.
  for (const sp of pack.spots) {
    for (const [hand, mix] of Object.entries(sp.hands)) {
      if (mix.fold !== undefined) {
        const rest = (mix.call ?? 0) + (mix.raise ?? 0) + (mix.allin ?? 0);
        if (Math.abs(rest + mix.fold - 1) > 0.02) throw new Error(`spot ${sp.id}, ${hand}: frequencies sum to ${(rest + mix.fold).toFixed(3)}, expected 1`);
        delete mix.fold;
      }
    }
  }
  return pack;
}

/** Parse any supported format (chosen by content), then validate. */
export function importPack(text: string, hint?: 'json' | 'text' | 'csv'): { pack: StrategyPack; issues: PackIssue[] } {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const kind = hint ?? (t.trimStart().startsWith('{') ? 'json' : /^\s*(#[^\n]*\n\s*)*scenario\s*,/i.test(t) ? 'csv' : 'text');
  const pack = kind === 'json' ? JSON.parse(t) as StrategyPack : kind === 'csv' ? parseCsvPack(t) : parseTextPack(t);
  return { pack, issues: validatePack(pack) };
}
