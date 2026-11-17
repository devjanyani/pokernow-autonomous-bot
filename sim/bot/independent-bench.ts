// ============================================================
// Version 1 against version 2 at tables of INDEPENDENT opponents (src/bot/sim/independent.ts): players that
// share nothing with either engine's opponent model, several of which punish frequent or oversized betting.
//
//   npx tsx sim/bot/independent-bench.ts [--tables hu-caller,hu-mdf,...] [--hands 3000] [--seed 8800] [--out report.md]
//
// Both engines play the same decks from the same seats (duplicate rotation, paired by deal). The seed is one
// that no earlier experiment used, and neither engine was changed after looking at these opponents.
// Reported: each engine's result and the paired difference in bb/100 with 95% intervals, and how often each
// engine bets when checked to and folds when facing a bet.
// ============================================================

import * as fs from 'fs';
import { bb100, pairedDiff } from '../../src/bot/sim/table';
import { REF_TABLES } from './reference-eval';
import { runVariant, V } from './strategy-diag';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const fmt = (r: { bb100: number; ci95: number }) => `${r.bb100 >= 0 ? '+' : ''}${r.bb100.toFixed(1)} ± ${r.ci95.toFixed(1)}`;

function rates(stats: Record<string, number>): { bet: string; fold: string } {
  let free = 0, bet = 0, facing = 0, fold = 0;
  for (const [k, n] of Object.entries(stats)) {
    const [street, kind, action] = k.split(':');
    if (street === 'pre') continue;
    if (kind === 'free') { free += n; if (action === 'bet') bet += n; } else { facing += n; if (action === 'fold') fold += n; }
  }
  return { bet: free ? `${(100 * bet / free).toFixed(0)}%` : '–', fold: facing ? `${(100 * fold / facing).toFixed(0)}%` : '–' };
}

async function main(): Promise<void> {
  const tables = argS('tables', 'hu-caller,hu-mdf,hu-trapper,hu-maniac,hu-nit,hu-punisher,six-independent,six-punishers').split(',');
  const hands = Number(argS('hands', '3000')), seed = Number(argS('seed', '8800'));
  const lines = [`## Version 2 against version 1 at tables of independent opponents`, '',
    `Seed ${seed}, about ${hands} hands per table and engine, duplicate rotation, paired by deal. bb/100 with 95% intervals; * marks a difference whose interval excludes zero.`, '',
    '| Table | Opponents | Hands | Version 1 | Version 2 | Version 2 minus version 1 | v1 bets when checked to / folds to a bet | v2 bets when checked to / folds to a bet |',
    '|---|---|---|---|---|---|---|---|'];
  console.log(lines.join('\n'));
  for (const t of tables) {
    const field = REF_TABLES[t];
    if (!field) throw new Error(`unknown table ${t}`);
    const n = field.length + 1;
    const h = Math.round(hands / n) * n;
    const a = await runVariant(V['v1/v1'], field, h, seed);
    const b = await runVariant(V['v2/v2'], field, h, seed);
    const d = pairedDiff(b.perDeal, a.perDeal);
    const ra = rates(a.stats), rb = rates(b.stats);
    const row = `| ${t} | ${field.join(', ')} | ${h} | ${fmt(bb100(a.perDeal))} | ${fmt(bb100(b.perDeal))} | ${fmt(d)}${Math.abs(d.bb100) > d.ci95 ? ' *' : ''} | ${ra.bet} / ${ra.fold} | ${rb.bet} / ${rb.fold} |`;
    console.log(row);
    lines.push(row);
  }
  const out = argS('out', '');
  if (out) fs.writeFileSync(out, lines.join('\n') + '\n');
}

if (process.argv[1] && /independent-bench\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
