// ============================================================
// Built-in packs: the two 6-max chart sets that ship in src/core/ranges,
// wrapped with their provenance so every decision that uses them says where
// the numbers came from and outside which assumptions they are being applied.
//
// Neither chart set's solver origin or licence can be verified from this
// repository, so both are registered as kind 'chart', verified: false.
// ============================================================

import { charts as greenline, Cell, Chart } from '../../../core/ranges/greenline-gto';
import { charts as pekarstas } from '../../../core/ranges/pekarstas-gto';
import { StrategyLibrary } from './library';
import { HandMix, PACK_FORMAT, PACK_VERSION, PreflopScenario, PreflopSpot, StrategyPack } from './types';
import type { Precedence } from './library';
import { USER_PACKS } from '../packs';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function cellMix(cell: Cell): HandMix {
  if (typeof cell === 'string') return cell === 'fold' ? {} : { [cell]: 1 };
  if (Array.isArray(cell)) {
    const m: Record<string, number> = {};
    for (const a of cell) m[a] = (m[a] ?? 0) + 0.5;
    delete m.fold;
    return m;
  }
  const w = clamp(cell.weight / 100, 0, 1);
  let tot = 0;
  for (const v of Object.values(cell.actions)) tot += v ?? 0;
  if (tot <= 0) return {};
  const m: Record<string, number> = {};
  for (const [a, v] of Object.entries(cell.actions)) if (a !== 'fold') m[a] = (w * (v ?? 0)) / tot;
  // Near-uniform three-way cells are unconverged nodes in the source charts, not real mixes: treated as folds.
  const live = [m.call ?? 0, m.raise ?? 0, m.allin ?? 0].filter((f) => f > 0.05);
  if (live.length >= 3 && Math.max(...live) - Math.min(...live) < 0.15) return {};
  return m;
}

function spotFromKey(key: string, chart: Chart): PreflopSpot | null {
  let scenario: PreflopScenario, hero: string, villain: string | undefined;
  let m = /^(\w+)-RFI$/.exec(key);
  if (m) { scenario = 'rfi'; hero = m[1]; }
  else if ((m = /^(\w+)-ISO$/.exec(key))) { hero = m[1]; scenario = hero === 'BB' ? 'bb-vs-limp' : 'vs-limp'; }
  else if ((m = /^(\w+)-vs-open-(\w+)$/.exec(key))) { scenario = 'vs-open'; hero = m[1]; villain = m[2]; }
  else if ((m = /^(\w+)-vs-3bet-(\w+)$/.exec(key))) { scenario = 'vs-3bet'; hero = m[1]; villain = m[2]; }
  else if ((m = /^(\w+)-vs-4bet-(\w+)$/.exec(key))) { scenario = 'vs-4bet'; hero = m[1]; villain = m[2]; }
  else return null;
  const hands: Record<string, HandMix> = {};
  for (const [cls, cell] of Object.entries(chart)) {
    const mix = cellMix(cell);
    if (Object.keys(mix).length) hands[cls] = mix;
  }
  if (Object.keys(hands).length === 0) return null;
  return { id: key, scenario, hero, villain, hands };
}

/**
 * What the Greenline source says about its own pages (comments in core/ranges/greenline-gto.ts, transcribed from the
 * PDF). Pages 6, 8, 9, 10 and 11 give opponent-dependent colours ("3bet vs weak opponents who fold to 3bet", "fold to
 * 4bet from passive opponents (otherwise call)", "3bet and call 4bet from passive opponents", "vs tight 3bettor"),
 * which the transcription merged into single actions. Pages 4 (open), 5 (isolate) and 7 (big blind defence) are
 * unconditional. Open sizes are stated on page 4.
 */
const GREENLINE_CONDITIONAL: [RegExp, string][] = [
  [/^SB-vs-open-/, 'Greenline page 6 (small blind defence) marks part of these 3-bets as "vs weak opponents who fold to 3bet"'],
  [/^BTN-vs-open-/, 'Greenline page 9 (3-bet in position) mixes "3bet and fold", "3bet and call 4bet from passive opponents" and "fold to 4bet from passive opponents (otherwise call)"'],
  [/^BB-vs-4bet-/, 'Greenline page 8 says "call 4bet, fold to 4bet from passive opponents (otherwise call)"'],
  [/-vs-3bet-/, 'Greenline pages 10-11 (defence vs 3-bet) give separate ranges by 3-bettor type ("vs tight 3bettor")'],
];
const GREENLINE_OPEN_BB: Record<string, number> = { UTG: 3, MP: 3, CO: 2.5, BTN: 2.5, SB: 3 };

function annotateGreenline(sp: PreflopSpot): PreflopSpot {
  const c = GREENLINE_CONDITIONAL.find(([re]) => re.test(sp.id));
  if (c) sp.conditional = c[1];
  if (sp.scenario === 'rfi' && GREENLINE_OPEN_BB[sp.hero] !== undefined) sp.sizing = { raiseToBB: GREENLINE_OPEN_BB[sp.hero] };
  return sp;
}

function chartPack(id: string, name: string, tool: string, charts: Record<string, Chart>, annotate: (sp: PreflopSpot) => PreflopSpot = (sp) => sp): StrategyPack {
  const spots: PreflopSpot[] = [];
  for (const [key, chart] of Object.entries(charts)) {
    const sp = spotFromKey(key, chart);
    if (sp) spots.push(annotate(sp));
  }
  return {
    format: PACK_FORMAT, version: PACK_VERSION, id, name, revision: '1',
    source: {
      kind: 'chart', tool, verified: false,
      license: 'third-party chart inherited from the repository this project was built on; licence and solver origin not verified',
      notes: 'Transcribed charts for six-handed cash games at about 100 big blinds. Pure and 50/50 cells; weighted cells where the chart gave them.',
    },
    assumptions: { format: 'cash', players: 6, stackBB: [60, 150], anteBB: 0, openSizeBB: 2.5 },
    positions: ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'],
    spots,
  };
}

export const BUILTIN_PACKS: StrategyPack[] = [
  chartPack('greenline-6max-100bb', 'Greenline 6-max chart', 'Greenline Poker GreenCharts 2024-01 (PDF transcription)', greenline, annotateGreenline),
  chartPack('pekarstas-6max-100bb', 'Pekarstas 6-max chart', 'Pekarstas 6-max chart pack (transcription)', pekarstas),
];

/** Library with user packs (strategy-packs imported at build time) registered before the built-in charts. */
export function buildDefaultLibrary(precedence: Precedence = 'registration'): { library: StrategyLibrary; rejected: { id: string; errors: string[] }[] } {
  const library = new StrategyLibrary(precedence);
  const rejected: { id: string; errors: string[] }[] = [];
  for (const p of [...USER_PACKS, ...BUILTIN_PACKS]) {
    const errors = library.register(p).filter((i) => i.level === 'error');
    if (errors.length) rejected.push({ id: p.id, errors: errors.map((e) => `${e.where}: ${e.message}`) });
  }
  return { library, rejected };
}

const cached = new Map<Precedence, StrategyLibrary>();
/** The built-in library. 'registration' precedence is what versions 2 and 3 use (unchanged since 0.6.0). */
export function defaultLibrary(precedence: Precedence = 'registration'): StrategyLibrary {
  let lib = cached.get(precedence);
  if (!lib) { lib = buildDefaultLibrary(precedence).library; cached.set(precedence, lib); }
  return lib;
}
