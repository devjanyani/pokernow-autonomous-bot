// ============================================================
// Phase 3.1 paired preflop evaluation harness. MEASUREMENT ONLY: src/ never imports it.
//
//   npx tsx sim/bot/v4-bench.ts --suite main|ablation|negative|smoke [--deals N] [--samples S] [--seed-base B]
//        [--cells id,id] [--json out.jsonl] [--out report.md]
//
// Every engine of a suite plays every cell on the SAME seed: same decks in the same order, same opponent programs
// with the same seeds, Hero in the same physical seat. Differences are paired by deal (per-deal net of Hero, in big
// blinds). Cells cover heads-up, six and nine players; 40 / 100 / 200bb; two opponent sizing profiles; the
// independent opponent programs (src/bot/sim/independent.ts: none of them is built from the bot's model).
//
// Reported per cell and pooled: bb/100 per engine and the paired difference against version 2 with a 95% interval;
// the same under a post-hoc rake (5% capped at 3bb, no flop no drop: the strategy does not see the rake, the
// evaluation charges it to the pot's winners); Hero's preflop action distribution by situation and position; the
// share of preflop decisions decided by each source (chart, approximation, heuristic, ...); illegal actions and
// legality-gate replacements; preflop decision latency.
//
// Correctness is tested elsewhere (tests/bot/*.test.ts). This file measures play only, and a lower fallback rate is
// never by itself evidence of better play.
// Development seeds: 32000 + cell index (Phase 3.1). Pre-registered, UNRUN final seeds: reports/V4_PREREGISTERED_SEEDS.md.
// ============================================================

import * as fs from 'fs';
import { createHash } from 'crypto';
import { AgentOptions } from '../../src/bot/agent';
import { CardId } from '../../src/bot/cards';
import { botPolicy, BotPolicy } from '../../src/bot/sim/policies';
import { INDEPENDENT_FACTORIES, PUNISHER_FACTORIES } from '../../src/bot/sim/independent';
import { bb100, Bb100, HandResult, pairedDiff, playSession, Policy, PolicyView } from '../../src/bot/sim/table';
import { classifyPreflop } from '../../src/bot/strategy/preflop-context';
import { legalActions, potTotal } from '../../src/bot/table/engine';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const argN = (f: string, d: number) => Number(argS(f, String(d)));

export const HERO = 'hero';
const BB = 100;

// ---------- opponents ----------

/**
 * Opponent sizing profile. 'std': each program's own sizes. 'big': the program's preflop raises are resized to a
 * 4bb open (+1bb per limper) and 4.5x re-raises, to test the bot against open and 3-bet sizes its charts do not assume.
 */
export type SizeProfile = 'std' | 'big';

function resized(inner: Policy, profile: SizeProfile): Policy {
  if (profile === 'std') return inner;
  return {
    name: `${inner.name}+big`,
    observe: inner.observe?.bind(inner),
    async act(v: PolicyView) {
      const a = await inner.act(v);
      if (v.h.street !== 'preflop' || (a.kind !== 'raise' && a.kind !== 'bet')) return a;
      const la = legalActions(v.h, v.seat)!;
      const raises = v.h.raisesThisStreet;
      const limpers = v.h.events.filter((e) => e.street === 'preflop' && e.kind === 'call').length;
      const want = raises === 0 ? (4 + limpers) * v.h.bigBlind : v.h.currentBet * 4.5;
      if ((a.to ?? 0) >= la.maxRaiseTo) return a; // keep all-ins
      return { kind: a.kind, to: Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, Math.round(want))) };
    },
  };
}

/** Opponent pools: tight (nit), loose-aggressive (maniac), loose-passive (pot-odds-caller), defending (mdf-defender), aggressive (raiser), trapping (trapper), adaptive (adaptive-punisher). */
const SIX_POOL = ['nit', 'maniac', 'pot-odds-caller', 'mdf-defender', 'raiser'];
const NINE_POOL = ['nit', 'maniac', 'pot-odds-caller', 'mdf-defender', 'raiser', 'trapper', 'adaptive-punisher', 'nit'];

export interface Cell { id: string; field: string[]; stackBB: number; sizes: SizeProfile }

export function cells(): Cell[] {
  const out: Cell[] = [];
  for (const opp of ['nit', 'maniac', 'pot-odds-caller', 'raiser']) for (const st of [40, 100, 200]) out.push({ id: `hu-${opp}-${st}`, field: [opp], stackBB: st, sizes: 'std' });
  for (const opp of ['nit', 'maniac', 'pot-odds-caller', 'raiser']) out.push({ id: `hu-${opp}-100-big`, field: [opp], stackBB: 100, sizes: 'big' });
  for (const [name, pool] of [['six', SIX_POOL], ['nine', NINE_POOL]] as const) {
    for (const st of [40, 100, 200]) for (const sz of ['std', 'big'] as SizeProfile[]) out.push({ id: `${name}-${st}-${sz}`, field: [...pool], stackBB: st, sizes: sz });
  }
  return out;
}

/**
 * Phase 3.1c cells (appended after cells(), so the 28 pre-registered cell indices are unchanged). Pools with the
 * value-punisher (src/bot/sim/independent.ts), which plays narrower, stronger ranges at small, tempting sizes than a
 * percentile model gives it and does not over-fold after the flop, with one loose limper per table.
 */
export function cells31c(): Cell[] {
  // Mostly punishers; one loose limper (pot-odds-caller) per table creates the limped and isolated pots.
  const six = ['value-punisher', 'value-punisher', 'pot-odds-caller', 'value-punisher', 'value-punisher'];
  const nine = ['value-punisher', 'value-punisher', 'pot-odds-caller', 'value-punisher', 'value-punisher', 'value-punisher', 'trapper', 'value-punisher'];
  const out: Cell[] = [];
  for (const st of [40, 100, 200]) out.push({ id: `six-punish-${st}`, field: [...six], stackBB: st, sizes: 'std' });
  for (const st of [40, 100, 200]) out.push({ id: `nine-punish-${st}`, field: [...nine], stackBB: st, sizes: 'std' });
  // Self-play: every opponent is version 2 itself (not independent, but the strongest opponent available here).
  for (const st of [40, 100]) out.push({ id: `nine-self-${st}`, field: Array(8).fill('bot-v2'), stackBB: st, sizes: 'std' });
  return out;
}
let selfSeed = 0;
const opponent = (k: string): Policy => k === 'bot-v2' ? botPolicy({ engine: 'v2', seed: 500 + (selfSeed++ % 8), samples: 150, name: 'bot-v2' }) : (INDEPENDENT_FACTORIES[k] ?? PUNISHER_FACTORIES[k])();

// ---------- engines ----------

export type EngineId = 'v2' | 'v2c' | 'v2-prec' | 'v2-opener' | 'v2-sizes' | 'v3pr' | 'v2-price' | 'neg-loose-call' | 'neg-limp-call' | 'neg-nit' | 'neg-random' | 'neg-fold';

const loadJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

function agentOpts(e: EngineId, samples: number): AgentOptions & { samples: number; name: string } {
  const base = { engine: 'v2' as const, seed: 7, samples, name: e };
  switch (e) {
    case 'v2c': return { ...base, preflopCorrections: { precedence: 'documented', consistentOpener: true, chartSizes: true } };
    case 'v2-prec': return { ...base, preflopCorrections: { precedence: 'documented' } };
    case 'v2-opener': return { ...base, preflopCorrections: { consistentOpener: true } };
    case 'v2-sizes': return { ...base, preflopCorrections: { chartSizes: true } };
    case 'v2-price': return { ...base, preflopCorrections: { priceAware: true } };
    case 'v3pr': return { ...base, engine: 'v3', v3Sensitivity: false, v3Population: loadJson('src/bot/strategy/v3/population-calibration.json'), v3RiverRange: loadJson('src/bot/strategy/v3/river-range-calibration.json') };
    default: return base;
  }
}

/** Per-engine counters of Hero's own decisions. */
export interface HeroStats {
  preflop: number;
  bySource: Record<string, number>;
  /** situation -> action -> count */
  actions: Record<string, Record<string, number>>;
  /** position -> first-in opportunities and raises */
  rfi: Record<string, { n: number; d: number }>;
  vpip: { n: number; d: number };
  safety: number;
  illegal: number;
  msPreflop: number[];
  /** Phase 3.1c: decisions in the two price-blind heuristic branches, and how many of them were changed fold -> call. */
  priceBlind: number;
  changed: number;
}
const newStats = (): HeroStats => ({ preflop: 0, bySource: {}, actions: {}, rfi: {}, vpip: { n: 0, d: 0 }, safety: 0, illegal: 0, msPreflop: [], priceBlind: 0, changed: 0 });

/** The basis lines of the two heuristic branches that do not read the price (strategy/preflop.ts). */
const PRICE_BLIND = (b: string) => (b.startsWith('heuristic: vs ') && b.includes('continue top')) || b.startsWith('heuristic: vs 3-bet without a chart');

/**
 * The measured seat. Version 2 / 3 variants are the bot itself. Negative controls (deliberately poor preflop play,
 * version 2 after the flop): 'neg-loose-call' (Phase 3.1c) is version 2 except that every fold in the two price-blind
 * heuristic branches becomes a call, whatever the price; 'neg-limp-call' never raises and calls everything preflop; 'neg-nit' plays only the top
 * ~3% (raises them) and folds the rest; 'neg-random' takes a uniformly random legal preflop action; 'neg-fold' folds
 * every hand preflop (checks when free).
 */
function measured(e: EngineId, samples: number, stats: HeroStats): Policy {
  const bot: BotPolicy = botPolicy(agentOpts(e, samples));
  bot.keepDecisions = false;
  const neg = e.startsWith('neg-') && e !== 'neg-loose-call';
  return {
    name: e,
    observe: (h, reveals) => bot.observe!(h, reveals),
    act(v: PolicyView) {
      if (v.h.street === 'preflop') {
        const c = classifyPreflop(v.h, v.seat);
        let out: { kind: 'fold' | 'check' | 'call' | 'bet' | 'raise'; to?: number };
        if (neg) out = negativeAction(e, v);
        else {
          const t0 = performance.now();
          const d = bot.agent.decideSync(v.h, v.seat, v.hole, samples);
          stats.msPreflop.push(performance.now() - t0);
          stats.bySource[d.preflop?.source ?? 'none'] = (stats.bySource[d.preflop?.source ?? 'none'] ?? 0) + 1;
          if (d.basis.some((b) => b.startsWith('safety:'))) stats.safety++;
          out = { kind: d.action, to: d.to };
          if (d.basis.some(PRICE_BLIND)) {
            stats.priceBlind++;
            if (d.basis.some((b) => b.includes('the fold share is called instead'))) stats.changed++;
            if (e === 'neg-loose-call' && d.action === 'fold' && v.la.canCall) { out = { kind: 'call' }; stats.changed++; }
          }
        }
        stats.preflop++;
        const pos = v.h.seats.find((s) => s.seat === v.seat)!.pos!.label;
        const sit = `${c.situation}`;
        const act = out.kind === 'raise' || out.kind === 'bet' ? (out.to !== undefined && out.to >= v.la.maxRaiseTo ? 'all-in' : 'raise') : out.kind;
        (stats.actions[sit] ??= {})[act] = (stats.actions[sit][act] ?? 0) + 1;
        if (c.situation === 'unopened' && !c.hero.isBigBlind) { const r = (stats.rfi[pos] ??= { n: 0, d: 0 }); r.d++; if (act === 'raise' || act === 'all-in') r.n++; }
        return out;
      }
      const d = bot.agent.decideSync(v.h, v.seat, v.hole, samples);
      if (d.basis.some((b) => b.startsWith('safety:'))) stats.safety++;
      return { kind: d.action, to: d.to };
    },
  };
}

const TOP3 = new Set(['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'TT']);
function cls(c: [CardId, CardId]): string {
  const R = '23456789TJQKA';
  const r1 = Math.floor(c[0] / 4), r2 = Math.floor(c[1] / 4), s1 = c[0] % 4, s2 = c[1] % 4;
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  return hi === lo ? R[hi] + R[lo] : R[hi] + R[lo] + (s1 === s2 ? 's' : 'o');
}
function negativeAction(e: EngineId, v: PolicyView): { kind: 'fold' | 'check' | 'call' | 'raise' | 'bet'; to?: number } {
  const la = v.la;
  const passive = { kind: (la.canCheck ? 'check' : 'call') as 'check' | 'call' };
  if (e === 'neg-fold') return la.canCheck ? { kind: 'check' } : { kind: 'fold' };
  if (e === 'neg-limp-call') return la.canCall || la.canCheck ? passive : { kind: 'fold' };
  if (e === 'neg-nit') {
    if (!TOP3.has(cls(v.hole))) return la.canCheck ? { kind: 'check' } : { kind: 'fold' };
    return la.canRaise ? { kind: la.raiseKind, to: Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, Math.round(v.h.currentBet * 3))) } : passive;
  }
  // neg-random: fold / passive / raise (min to 4x) / all-in, uniformly among the legal ones
  const opts: { kind: 'fold' | 'check' | 'call' | 'raise' | 'bet'; to?: number }[] = [];
  if (!la.canCheck) opts.push({ kind: 'fold' });
  opts.push(passive);
  if (la.canRaise) { opts.push({ kind: la.raiseKind, to: Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, Math.round(v.h.currentBet * (2 + 2 * v.rng.next())))) }); opts.push({ kind: la.raiseKind, to: la.maxRaiseTo }); }
  return opts[Math.floor(v.rng.next() * opts.length)];
}

// ---------- rake (post hoc) ----------

export interface Rake { pct: number; capBB: number }
export const RAKE: Rake = { pct: 0.05, capBB: 3 };

/** Hero's net after a post-hoc rake: no flop, no drop; the rake is charged to the winners in proportion to their winnings. */
function rakedNet(r: HandResult, heroSeat: number, rake: Rake): number {
  const net = r.nets.get(heroSeat) ?? 0;
  if (r.h.board.length < 3) return net;
  const pot = potTotal(r.h);
  const take = Math.min(rake.capBB * r.h.bigBlind, rake.pct * pot);
  let won = 0;
  for (const v of r.nets.values()) if (v > 0) won += v;
  return net > 0 && won > 0 ? net - take * (net / won) : net;
}

// ---------- one cell ----------

export interface CellResult {
  cell: string; engine: EngineId; seed: number; deals: number;
  result: Bb100; raked: Bb100; perDeal: number[]; perDealRaked: number[];
  stats: HeroStats; hash: string;
}

export async function runCell(c: Cell, e: EngineId, deals: number, seed: number, samples: number): Promise<CellResult> {
  const stats = newStats();
  const hero = measured(e, samples, stats);
  const players = [{ playerId: HERO, policy: hero }, ...c.field.map((k, i) => ({ playerId: `${k}-${i}`, policy: resized(opponent(k), c.sizes) }))];
  const perDeal: number[] = [], perDealRaked: number[] = [];
  const res = await playSession({
    players, hands: deals, seed, smallBlind: BB / 2, bigBlind: BB, startStack: c.stackBB * BB, mode: 'cash',
    onHand: (r) => {
      const hs = r.h.seats.find((s) => s.playerId === HERO)!;
      perDeal.push((r.nets.get(hs.seat) ?? 0) / BB);
      perDealRaked.push(rakedNet(r, hs.seat, RAKE) / BB);
      if (hs.dealtIn) {
        const pre = r.h.events.filter((x) => x.street === 'preflop' && x.seat === hs.seat && !x.kind.startsWith('post'));
        if (pre.some((x) => x.kind !== 'check')) { stats.vpip.d++; if (pre.some((x) => x.kind === 'call' || x.kind === 'raise')) stats.vpip.n++; }
      }
    },
  });
  stats.illegal = res.illegal.filter((x) => x.policy === e).length;
  const hash = createHash('sha256').update(JSON.stringify(perDeal)).digest('hex').slice(0, 16);
  return { cell: c.id, engine: e, seed, deals: perDeal.length, result: bb100(perDeal), raked: bb100(perDealRaked), perDeal, perDealRaked, stats, hash };
}

// ---------- suites ----------

const SUITES: Record<string, { engines: EngineId[]; cells: (all: Cell[]) => Cell[] }> = {
  main: { engines: ['v2', 'v2c'], cells: (all) => all },
  ablation: { engines: ['v2', 'v2-prec', 'v2-opener', 'v2-sizes'], cells: (all) => all.filter((c) => /^(six|nine)-100-/.test(c.id)) },
  negative: { engines: ['v2', 'neg-limp-call', 'neg-nit', 'neg-random', 'neg-fold'], cells: (all) => all.filter((c) => ['hu-nit-100', 'hu-maniac-100', 'six-100-std', 'nine-100-std', 'six-40-std', 'nine-200-std'].includes(c.id)) },
  smoke: { engines: ['v2', 'neg-fold'], cells: (all) => all.filter((c) => c.id === 'hu-pot-odds-caller-100') },
  // Phase 3.1c: the price check against v2 and the loose-calling negative control, on the ring pools and the
  // punisher pools. Development seeds 33000 + cell index; held-out 34000 + cell index (reports/V4_PREREGISTERED_SEEDS.md).
  c31: { engines: ['v2', 'v2-price', 'neg-loose-call'], cells: (all) => all.filter((c) => /^(six|nine)-(40|100|200)-(std|big)$/.test(c.id) || /-(punish|self)-/.test(c.id)) },
};

const fmt = (r: { bb100: number; ci95: number }) => `${r.bb100 >= 0 ? '+' : ''}${r.bb100.toFixed(1)} ± ${r.ci95.toFixed(1)}`;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const p95 = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(0.95 * (s.length - 1))] : 0; };

export function report(results: CellResult[], title: string): string[] {
  const engines = [...new Set(results.map((r) => r.engine))];
  const cellIds = [...new Set(results.map((r) => r.cell))];
  const get = (c: string, e: EngineId) => results.find((r) => r.cell === c && r.engine === e)!;
  const out: string[] = [`## ${title}`, ''];
  out.push(`| cell | deals | ${engines.map((e) => `${e} bb/100`).join(' | ')} | ${engines.filter((e) => e !== 'v2').map((e) => `${e} − v2`).join(' | ')} |`);
  out.push(`|---|---|${engines.map(() => '---').join('|')}|${engines.filter((e) => e !== 'v2').map(() => '---').join('|')}|`);
  for (const c of cellIds) {
    const base = get(c, 'v2');
    out.push(`| ${c} | ${base.deals} | ${engines.map((e) => fmt(get(c, e).result)).join(' | ')} | ${engines.filter((e) => e !== 'v2').map((e) => { const d = pairedDiff(get(c, e).perDeal, base.perDeal); return `${fmt(d)}${Math.abs(d.bb100) > d.ci95 ? ' *' : ''}`; }).join(' | ')} |`);
  }
  const pooled = (e: EngineId, raked: boolean) => {
    const a: number[] = [], b: number[] = [];
    for (const c of cellIds) { const x = get(c, e), y = get(c, 'v2'); a.push(...(raked ? x.perDealRaked : x.perDeal)); b.push(...(raked ? y.perDealRaked : y.perDeal)); }
    return { own: bb100(a), diff: pairedDiff(a, b) };
  };
  out.push('', '| pooled over the cells above | bb/100 (no rake) | − v2 (no rake) | bb/100 (5% rake, 3bb cap) | − v2 (rake) |', '|---|---|---|---|---|');
  for (const e of engines) {
    const p = pooled(e, false), q = pooled(e, true);
    out.push(`| ${e} | ${fmt(p.own)} | ${e === 'v2' ? '—' : `${fmt(p.diff)}${Math.abs(p.diff.bb100) > p.diff.ci95 ? ' *' : ''}`} | ${fmt(q.own)} | ${e === 'v2' ? '—' : `${fmt(q.diff)}${Math.abs(q.diff.bb100) > q.diff.ci95 ? ' *' : ''}`} |`);
  }
  out.push('', '`*`: the 95% interval excludes 0.', '');
  // Process measures per engine, pooled.
  out.push('| engine | preflop decisions | VPIP | price-blind heuristic decisions | changed to call | sources (share of preflop decisions) | legality-gate replacements | illegal actions | preflop latency median / p95 |', '|---|---|---|---|---|---|---|---|---|');
  for (const e of engines) {
    const rs = results.filter((r) => r.engine === e);
    const n = rs.reduce((t, r) => t + r.stats.preflop, 0);
    const src: Record<string, number> = {};
    for (const r of rs) for (const [k, v] of Object.entries(r.stats.bySource)) src[k] = (src[k] ?? 0) + v;
    const tot = Object.values(src).reduce((a, b) => a + b, 0);
    const ms = rs.flatMap((r) => r.stats.msPreflop);
    out.push(`| ${e} | ${n} | ${pct(rs.reduce((t, r) => t + r.stats.vpip.n, 0), rs.reduce((t, r) => t + r.stats.vpip.d, 0))} | ${rs.reduce((t, r) => t + (r.stats.priceBlind ?? 0), 0)} | ${rs.reduce((t, r) => t + (r.stats.changed ?? 0), 0)} | ${tot ? Object.entries(src).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, tot)}`).join(', ') : 'n/a (scripted)'} | ${rs.reduce((t, r) => t + r.stats.safety, 0)} | ${rs.reduce((t, r) => t + r.stats.illegal, 0)} | ${ms.length ? `${median(ms).toFixed(1)} / ${p95(ms).toFixed(1)} ms` : 'n/a'} |`);
  }
  out.push('');
  // Action distribution by situation for the bot variants.
  const sits = new Set<string>();
  for (const r of results) for (const s of Object.keys(r.stats.actions)) sits.add(s);
  const acts = ['fold', 'check', 'call', 'raise', 'all-in'];
  out.push(`| situation | engine | decisions | ${acts.join(' | ')} |`, `|---|---|---|${acts.map(() => '---').join('|')}|`);
  for (const s of [...sits].sort()) {
    for (const e of engines.filter((x) => !x.startsWith('neg-'))) {
      const agg: Record<string, number> = {};
      for (const r of results.filter((x) => x.engine === e)) for (const [k, v] of Object.entries(r.stats.actions[s] ?? {})) agg[k] = (agg[k] ?? 0) + v;
      const tot = Object.values(agg).reduce((a, b) => a + b, 0);
      if (tot) out.push(`| ${s} | ${e} | ${tot} | ${acts.map((a) => pct(agg[a] ?? 0, tot)).join(' | ')} |`);
    }
  }
  out.push('');
  const rfiPos = new Set<string>();
  for (const r of results) for (const k of Object.keys(r.stats.rfi)) rfiPos.add(k);
  out.push(`| first-in raise by position | ${[...rfiPos].sort().join(' | ')} |`, `|---|${[...rfiPos].map(() => '---').join('|')}|`);
  for (const e of engines.filter((x) => !x.startsWith('neg-'))) {
    out.push(`| ${e} | ${[...rfiPos].sort().map((p) => { let n = 0, d = 0; for (const r of results.filter((x) => x.engine === e)) { n += r.stats.rfi[p]?.n ?? 0; d += r.stats.rfi[p]?.d ?? 0; } return pct(n, d); }).join(' | ')} |`);
  }
  out.push('');
  return out;
}

async function main(): Promise<void> {
  const suite = argS('suite', 'smoke');
  const cfg = SUITES[suite];
  if (!cfg) throw new Error(`unknown suite ${suite}`);
  const deals = argN('deals', 1000), samples = argN('samples', 150), seedBase = argN('seed-base', 32000);
  const all = [...cells(), ...cells31c()];
  const only = argS('cells', '');
  const list = cfg.cells(all).filter((c) => !only || only.split(',').includes(c.id));
  const engines = argS('engines', '') ? argS('engines', '').split(',') as EngineId[] : cfg.engines;
  const results: CellResult[] = [];
  const jsonFile = argS('json', '');
  const t0 = Date.now();
  for (const c of list) {
    const seed = seedBase + all.findIndex((x) => x.id === c.id);
    for (const e of engines) {
      const r = await runCell(c, e, deals, seed, samples);
      results.push(r);
      console.error(`${c.id} ${e} seed ${seed}: ${fmt(r.result)} (${r.deals} deals, hash ${r.hash}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      if (jsonFile) fs.appendFileSync(jsonFile, JSON.stringify({ ...r, perDeal: r.perDeal, perDealRaked: r.perDealRaked }) + '\n');
    }
  }
  const lines = [`# Phase 3.1 preflop evaluation: suite "${suite}"`, '',
    `Engines ${engines.join(', ')}; ${deals} deals per cell; ${samples} postflop samples per decision; seeds ${seedBase} + cell index (development seeds). Paired by deal; 95% intervals. Opponents: independent programs (src/bot/sim/independent.ts); "big" = opponents' preflop raises resized to 4bb opens and 4.5x re-raises. Rake applied after the fact (the strategy does not model rake). Wall time ${((Date.now() - t0) / 60000).toFixed(1)} min.`, '',
    ...report(results, `Results (${list.length} cells)`)];
  const out = argS('out', '');
  if (out) fs.writeFileSync(out, lines.join('\n'));
  console.log(lines.join('\n'));
}

if (process.argv[1] && /v4-bench\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
