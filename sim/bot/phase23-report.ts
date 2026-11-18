// Turns the Phase 2.3 / 2.4 benchmark lines (phase23-bench.ts --json) into report tables, with paired differences
// pooled by opponent family. Works with any subset of the engines v1, v2, v3, ml.
//   npx tsx sim/bot/phase23-report.ts reports/phase23-bench-12100.jsonl [more.jsonl ...] > out.md
import * as fs from 'fs';
import { pairedDiff } from '../../src/bot/sim/table';

interface Line { table: string; field: string[]; hands: number; seed: number; results: Record<string, { bb100: number; ci95: number; perDeal: number[]; stats: { free: number; bet: number; facing: number; fold: number; raiseFacing: number; xrChance: number; xr: number; msMedian: number; msP95: number } }> }
const lines: Line[] = process.argv.slice(2).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line));
const FAMILY: Record<string, string> = {
  'hu-tag': 'archetypes (version 1 model)', 'hu-lag': 'archetypes (version 1 model)', 'hu-tight-passive': 'archetypes (version 1 model)', 'hu-loose-passive': 'archetypes (version 1 model)',
  'hu-station': 'simple and independent', 'hu-maniac': 'simple and independent', 'hu-raiser': 'simple and independent', 'hu-trapper': 'simple and independent', 'hu-mdf': 'simple and independent',
  'hu-punisher': 'simple and independent', 'hu-caller': 'simple and independent', 'hu-nit': 'simple and independent', 'hu-re': 'simple and independent',
  'hu-ra': 'version 2 model', 'six-mixed': 'six-handed', 'six-independent': 'six-handed', 'six-aggro': 'six-handed',
};
const fmt = (r: { bb100: number; ci95: number }) => `${r.bb100 >= 0 ? '+' : ''}${r.bb100.toFixed(1)} ± ${r.ci95.toFixed(1)}${Math.abs(r.bb100) > r.ci95 ? ' *' : ''}`;
const pct = (a: number, b: number) => (b ? `${(100 * a / b).toFixed(0)}%` : '–');
const engines = ['v1', 'v2', 'v3', 'ml'].filter((e) => lines.every((l) => l.results[e]));
const PAIRS = ([['v3', 'v2'], ['v3', 'v1'], ['v2', 'v1'], ['ml', 'v2']] as [string, string][]).filter(([a, b]) => engines.includes(a) && engines.includes(b));
const diff = (l: Line, a: string, b: string) => pairedDiff(l.results[a].perDeal, l.results[b].perDeal);
const out: string[] = [];
const tablePairs = PAIRS.filter(([a, b]) => !(a === 'v2' && b === 'v1'));
out.push(`| Table | Opponents | Hands | ${engines.join(' | ')} | ${tablePairs.map(([a, b]) => `${a} − ${b}`).join(' | ')} |`, `|---|---|---|${engines.map(() => '---').join('|')}|${tablePairs.map(() => '---').join('|')}|`);
for (const l of lines) out.push(`| ${l.table} | ${l.field.join(', ')} | ${l.hands} | ${engines.map((e) => fmt(l.results[e])).join(' | ')} | ${tablePairs.map(([a, b]) => fmt(diff(l, a, b))).join(' | ')} |`);
const poolPairs = PAIRS.filter(([a]) => a !== 'ml');
out.push('', '**Pooled by opponent family** (equal weight per table; interval from the tables\' own standard errors, which are independent):', '', `| Family | Tables | ${poolPairs.map(([a, b]) => `${a} − ${b}`).join(' | ')} |`, `|---|---|${poolPairs.map(() => '---').join('|')}|`);
const fams = [...new Set(lines.map((l) => FAMILY[l.table] ?? 'other'))];
const pool = (ls: Line[], a: string, b: string) => {
  const ds = ls.map((l) => diff(l, a, b));
  const m = ds.reduce((s, d) => s + d.bb100, 0) / ds.length;
  const ci = Math.sqrt(ds.reduce((s, d) => s + (d.ci95 / 1.96) ** 2, 0)) / ds.length * 1.96;
  return { bb100: m, ci95: ci };
};
for (const f of [...fams, 'all heads-up', 'all heads-up except version 2 model']) {
  const ls = f === 'all heads-up' ? lines.filter((l) => l.table.startsWith('hu-'))
    : f === 'all heads-up except version 2 model' ? lines.filter((l) => l.table.startsWith('hu-') && l.table !== 'hu-ra')
      : lines.filter((l) => (FAMILY[l.table] ?? 'other') === f);
  if (!ls.length) continue;
  out.push(`| ${f} | ${ls.length} | ${poolPairs.map(([a, b]) => fmt(pool(ls, a, b))).join(' | ')} |`);
}
out.push('', '**What each engine did after the flop** (bets when checked to / folds facing a bet / raises facing a bet / check-raises when possible, with the number of check-raise chances):', '', `| Table | ${engines.join(' | ')} |`, `|---|${engines.map(() => '---').join('|')}|`);
for (const l of lines) out.push(`| ${l.table} | ${engines.map((e) => { const s = l.results[e].stats; return `${pct(s.bet, s.free)} / ${pct(s.fold, s.facing)} / ${pct(s.raiseFacing, s.facing)} / ${pct(s.xr, s.xrChance)} (${s.xrChance})`; }).join(' | ')} |`);
const ms = lines.map((l) => l.results.v3?.stats).filter(Boolean);
if (ms.length) out.push('', `Version 3 postflop decision time in the simulator (400 deals, no sensitivity pass): median of table medians ${ms.map((s) => s!.msMedian).sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(0)} ms; largest 95th percentile ${Math.max(...ms.map((s) => s!.msP95)).toFixed(0)} ms.`);
console.log(out.join('\n'));
