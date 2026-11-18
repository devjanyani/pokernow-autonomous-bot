// ============================================================
// Phase 2.3 benchmark: version 1, version 2, version 3 (and the PokerBench model where it applies), same decks.
//
//   npx tsx sim/bot/phase23-bench.ts [--tables hu-tag,hu-lag,...] [--engines v1,v2,v3,ml] [--hands 2000] [--seed 12100]
//        [--samples 400] [--out report.md] [--json lines.jsonl]
//
// Every engine plays the same decks from the same seats against the same opponents with the same opponent
// seeds (duplicate rotation: each deck is played from every seat and counts as one sample), so differences
// are paired by deal. Preflop is version 2 for v2, v3 and ml; version 3 and the model replace version 2 only
// in heads-up pots after the flop (elsewhere they ARE version 2, which keeps multiway comparisons honest).
//
// Reported per table: bb/100 of each engine; paired differences v3-v2, v3-v1, ml-v2 with 95% intervals; how
// often each engine bets when checked to, folds facing a bet, check-raises when it can; postflop decision
// latency (median and 95th percentile).
// Seeds from 12100 up were not used by any earlier experiment.
// ============================================================

import * as fs from 'fs';
import { bb100, pairedDiff, playSession, Policy, PolicyView } from '../../src/bot/sim/table';
import { botPolicy } from '../../src/bot/sim/policies';
import { mlAdvice } from './ml-adapter';
import { makePolicy } from './run';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const argN = (f: string, d: number) => Number(argS(f, String(d)));
const fmt = (r: { bb100: number; ci95: number }) => `${r.bb100 >= 0 ? '+' : ''}${r.bb100.toFixed(1)} ± ${r.ci95.toFixed(1)}`;
const sig = (r: { bb100: number; ci95: number }) => (Math.abs(r.bb100) > r.ci95 ? ' *' : '');

export const BENCH_TABLES: Record<string, string[]> = {
  // Archetypes built from the version 1 behaviour model.
  'hu-tag': ['tight-aggressive'], 'hu-lag': ['loose-aggressive'], 'hu-tight-passive': ['tight-passive'], 'hu-loose-passive': ['loose-passive'],
  // Simple and independent opponents (not built from either engine's model).
  'hu-station': ['calling-station'], 'hu-maniac': ['maniac'], 'hu-raiser': ['raiser'], 'hu-trapper': ['trapper'], 'hu-mdf': ['mdf-defender'],
  'hu-punisher': ['adaptive-punisher'], 'hu-caller': ['pot-odds-caller'], 'hu-nit': ['nit'], 'hu-re': ['range-equity'],
  // Version 2's own model, as an opponent.
  'hu-ra': ['range-aware'],
  // Six-handed: heads-up pots after the flop use version 3; multiway pots are version 2 for both.
  'six-mixed': ['range-aware', 'tight-aggressive', 'range-equity', 'loose-passive', 'range-aware'],
  'six-independent': ['pot-odds-caller', 'mdf-defender', 'trapper', 'maniac', 'nit'],
  'six-aggro': ['loose-aggressive', 'raiser', 'maniac', 'adaptive-punisher', 'trapper'],
};

type Eng = 'v1' | 'v2' | 'v3' | 'ml';
interface Stats { free: number; bet: number; facing: number; fold: number; raiseFacing: number; xrChance: number; xr: number; ms: number[] }
const newStats = (): Stats => ({ free: 0, bet: 0, facing: 0, fold: 0, raiseFacing: 0, xrChance: 0, xr: 0, ms: [] });

function measured(eng: Eng, seed: number, samples: number, stats: Stats): Policy {
  const inner = eng === 'v1' ? botPolicy({ samples, seed, engine: 'v1', name: 'v1' })
    : botPolicy({ samples, seed, engine: eng === 'v3' ? 'v3' : 'v2', name: eng, v3Sensitivity: false });
  return {
    name: eng,
    observe: inner.observe,
    act(view: PolicyView) {
      const { h, seat, la } = view;
      const t0 = performance.now();
      let c: { kind: string; to?: number };
      const heads = h.seats.filter((s) => s.dealtIn && !s.folded).length === 2;
      if (eng === 'ml' && h.street !== 'preflop' && heads) {
        const a = mlAdvice(h, seat, view.hole, la);
        c = a ? { kind: a.action, to: a.to } : (inner.act(view) as { kind: string; to?: number });
      } else c = inner.act(view) as { kind: string; to?: number };
      if (h.street !== 'preflop') {
        stats.ms.push(performance.now() - t0);
        if (la.canCheck) { stats.free++; if (c.kind === 'bet') stats.bet++; }
        else {
          stats.facing++; if (c.kind === 'fold') stats.fold++; if (c.kind === 'raise') stats.raiseFacing++;
          const checkedThisStreet = h.events.some((e) => e.street === h.street && e.seat === seat && e.kind === 'check');
          if (checkedThisStreet && la.canRaise) { stats.xrChance++; if (c.kind === 'raise') stats.xr++; }
        }
      }
      return c as ReturnType<Policy['act']>;
    },
  };
}

export async function runEngine(eng: Eng, field: string[], hands: number, seed: number, samples: number): Promise<{ perDeal: number[]; stats: Stats; seconds: number }> {
  const stats = newStats();
  const t0 = Date.now();
  const players = [{ playerId: '0', policy: measured(eng, seed, samples, stats) }, ...field.map((sp, i) => ({ playerId: `${i + 1}`, policy: makePolicy(sp, samples, seed + i + 1) }))];
  const res = await playSession({ players, hands, seed, smallBlind: 10, bigBlind: 20, startStack: 2000, duplicate: true });
  return { perDeal: res.totals.get('0')!.perDeal, stats, seconds: (Date.now() - t0) / 1000 };
}

const pct = (a: number, b: number) => (b ? `${(100 * a / b).toFixed(0)}%` : '–');
const q = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function main(): Promise<void> {
  const tables = argS('tables', Object.keys(BENCH_TABLES).join(',')).split(',');
  const engines = argS('engines', 'v1,v2,v3').split(',') as Eng[];
  const hands = argN('hands', 2000), seed = argN('seed', 12100), samples = argN('samples', 400);
  const out = argS('out', ''), json = argS('json', '');
  const head = ['| Table | Hands | ' + engines.map((e) => e).join(' | ') + ' | v3 − v2 | v3 − v1 |' + (engines.includes('ml') ? ' ml − v2 |' : '') + ' Bets when checked to (' + engines.join(' / ') + ') | Folds to a bet | Check-raises when possible | v3 postflop ms (median / p95) |',
    '|---|---|' + engines.map(() => '---').join('|') + '|---|---|' + (engines.includes('ml') ? '---|' : '') + '---|---|---|---|'];
  const lines = [`## Phase 2.3 benchmark, seed ${seed}, ${samples} samples per decision`, '', ...head];
  console.log(lines.join('\n'));
  for (const t of tables) {
    const field = BENCH_TABLES[t];
    if (!field) throw new Error(`unknown table ${t}`);
    const n = field.length + 1;
    const h = Math.round(hands / n) * n;
    const r: Partial<Record<Eng, Awaited<ReturnType<typeof runEngine>>>> = {};
    for (const e of engines) { r[e] = await runEngine(e, field, h, seed, samples); console.error(`${t} ${e}: ${fmt(bb100(r[e]!.perDeal))} in ${r[e]!.seconds.toFixed(0)} s`); }
    const d = (a: Eng, b: Eng) => (r[a] && r[b] ? pairedDiff(r[a]!.perDeal, r[b]!.perDeal) : null);
    const cell = (x: ReturnType<typeof d>) => (x ? `${fmt(x)}${sig(x)}` : '–');
    const st = (f: (s: Stats) => string) => engines.map((e) => f(r[e]!.stats)).join(' / ');
    const v3ms = r.v3 ? `${q(r.v3.stats.ms, 0.5).toFixed(0)} / ${q(r.v3.stats.ms, 0.95).toFixed(0)}` : '–';
    const row = `| ${t} | ${h} | ${engines.map((e) => fmt(bb100(r[e]!.perDeal))).join(' | ')} | ${cell(d('v3', 'v2'))} | ${cell(d('v3', 'v1'))} |${engines.includes('ml') ? ` ${cell(d('ml', 'v2'))} |` : ''} ${st((s) => pct(s.bet, s.free))} | ${st((s) => pct(s.fold, s.facing))} | ${st((s) => `${pct(s.xr, s.xrChance)} of ${s.xrChance}`)} | ${v3ms} |`;
    console.log(row);
    lines.push(row);
    if (json) fs.appendFileSync(json, JSON.stringify({ table: t, field, hands: h, seed, samples, results: Object.fromEntries(engines.map((e) => [e, { ...bb100(r[e]!.perDeal), perDeal: r[e]!.perDeal.map((x) => Math.round(x * 1e4) / 1e4), stats: { ...r[e]!.stats, ms: undefined, msMedian: q(r[e]!.stats.ms, 0.5), msP95: q(r[e]!.stats.ms, 0.95) }, seconds: r[e]!.seconds }])), diffs: { v3v2: d('v3', 'v2'), v3v1: d('v3', 'v1'), mlv2: d('ml', 'v2') } }) + '\n');
    if (out) fs.writeFileSync(out, lines.join('\n') + '\n');
  }
}

if (process.argv[1] && /phase23-bench\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
