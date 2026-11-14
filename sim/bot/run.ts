// ============================================================
// Offline session runner.
//
//   npx tsx sim/bot/run.ts --players bot,tight-aggressive,loose-passive --hands 2000
//   npx tsx sim/bot/run.ts --players bot,legacy-engine --hands 1000 --duplicate
//   npx tsx sim/bot/run.ts --players bot,random,random --hands 50 --log reports/decisions.jsonl
//
// Options: --seed N  --stack BB (default 100)  --samples N (bot Monte Carlo per decision)
//          --duplicate (rotate each deck through every seat)  --ante CHIPS  --straddle CHIPS
//          --tournament (stacks carry over, blinds double every 20 hands)
//          --log FILE (write one JSON line per bot decision)
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { bb100, playSession, Policy } from '../../src/bot/sim/table';
import { botPolicy, BotPolicy, deviatingPolicy, POLICY_FACTORIES } from '../../src/bot/sim/policies';
import { cardsStr } from '../../src/bot/cards';
import { legacyEnginePolicy } from './legacy-seat';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? 'true' : v;
}

export function makePolicy(spec: string, samples: number, seed: number): Policy {
  if (spec === 'bot') return botPolicy({ samples, seed });
  if (spec === 'bot-v1') return botPolicy({ samples, seed, engine: 'v1', name: 'bot-v1' });
  if (spec === 'bot-deviating') return deviatingPolicy(botPolicy({ samples, seed }));
  if (spec === 'bot-v1-deviating') return deviatingPolicy(botPolicy({ samples, seed, engine: 'v1', name: 'bot-v1' }));
  if (spec === 'bot-v1-noexploit') return botPolicy({ samples, seed, engine: 'v1', exploitWeight: 0, name: 'bot-v1-noexploit' });
  if (spec === 'bot-noexploit') return botPolicy({ samples, seed, exploitWeight: 0, name: 'bot-noexploit' });
  if (spec === 'legacy-engine') return legacyEnginePolicy();
  const f = POLICY_FACTORIES[spec];
  if (!f) throw new Error(`unknown policy "${spec}". Known: bot, bot-noexploit, legacy-engine, ${Object.keys(POLICY_FACTORIES).join(', ')}`);
  return f();
}

export const pctl = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main(): Promise<void> {
  const specs = (arg('players', 'bot,tight-aggressive,loose-passive,tight-passive,loose-aggressive,range-equity') as string).split(',');
  const hands = Number(arg('hands', '1000'));
  const seed = Number(arg('seed', '1'));
  const stackBB = Number(arg('stack', '100'));
  const samples = Number(arg('samples', '400'));
  const bb = 20, sb = 10;
  const logFile = arg('log');
  const players = specs.map((s, i) => ({ playerId: `${s}#${i}`, policy: makePolicy(s, samples, seed + i) }));
  const bots = players.map((p) => p.policy).filter((p): p is BotPolicy => 'agent' in p);
  if (logFile) { for (const b of bots) b.keepDecisions = true; fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true }); fs.writeFileSync(logFile, ''); }
  const tournament = arg('tournament') === 'true';
  const t0 = Date.now();
  const res = await playSession({
    players, hands, seed, smallBlind: sb, bigBlind: bb, startStack: stackBB * bb,
    ante: arg('ante') ? Number(arg('ante')) : undefined, straddle: arg('straddle') ? Number(arg('straddle')) : undefined,
    duplicate: arg('duplicate') === 'true', mode: tournament ? 'tournament' : 'cash',
    levels: tournament ? Array.from({ length: 12 }, (_, i) => ({ hands: 20, smallBlind: sb * 2 ** i, bigBlind: bb * 2 ** i })) : undefined,
    onHand: logFile ? (r) => {
      for (const b of bots) {
        for (const d of b.decisions) {
          fs.appendFileSync(logFile, JSON.stringify({ hand: r.h.handId, board: cardsStr(r.h.board), street: d.street, action: d.label, mode: d.mode, equity: d.equity?.equity, candidates: d.candidates, basis: d.basis, adjustments: d.adjustments, uncertainty: d.uncertainty, ranges: d.ranges, counts: d.counts, ms: d.computeMs }) + '\n');
        }
        b.decisions.length = 0;
      }
    } : undefined,
  });
  console.log(`\n${res.hands} hands, ${specs.length} players, ${stackBB}bb, seed ${seed}${arg('duplicate') === 'true' ? ', duplicate rotation' : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log('player'.padEnd(26) + 'hands'.padStart(7) + 'bb/100'.padStart(11) + '95% CI'.padStart(11) + '  decision ms p50/p95/max');
  for (const t of res.totals.values()) {
    const r = bb100(t.perDeal);
    const lat = res.latencyByPolicy.get(t.policy) ?? [];
    console.log(t.playerId.padEnd(26) + String(t.hands).padStart(7) + r.bb100.toFixed(1).padStart(11) + `±${r.ci95.toFixed(1)}`.padStart(11)
      + `  ${pctl(lat, 50).toFixed(2)}/${pctl(lat, 95).toFixed(2)}/${Math.max(0, ...lat).toFixed(1)}`);
  }
  console.log(`illegal action attempts: ${res.illegal.length}` + (res.illegal.length ? ` ${JSON.stringify(res.illegal.slice(0, 5))}` : ''));
  if (tournament) console.log(`bust order: ${res.bustOrder.join(', ')}; winner: ${res.winner ?? 'undecided'}`);
  if (logFile) console.log(`decision log: ${logFile}`);
}

if (process.argv[1] && /run\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
