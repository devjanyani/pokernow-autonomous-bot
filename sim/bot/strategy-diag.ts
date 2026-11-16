// ============================================================
// Diagnosis experiments for the version 2 strategy engine (docs/bot/STRATEGY_V2_DIAGNOSIS.md).
//
//   npx tsx sim/bot/strategy-diag.ts --exp repro                      reproduce one row of the 2026-11-14 benchmark exactly
//   npx tsx sim/bot/strategy-diag.ts --exp factorial --table hu-tag   preflop engine x postflop engine, same decks
//   npx tsx sim/bot/strategy-diag.ts --exp direct                     three seats of a variant against three v1 seats
//   npx tsx sim/bot/strategy-diag.ts --exp ablate --table hu-tag      v2 postflop with one assumption switched off at a time
//
// Options: --hands N  --seed N  --samples N (default 400)  --json FILE (append one JSON line per result)
//
// Every comparison is PAIRED: the same decks, seats, opponents and opponent seeds, with only the measured
// seat's engine changed, in duplicate rotation (each deck played from every seat = one sample).
// Seeds: these experiments are development runs. The held-out benchmark seed (2027) is only used by `repro`.
// ============================================================

import * as fs from 'fs';
import { bb100, pairedDiff, playSession, Policy, PolicyView } from '../../src/bot/sim/table';
import { botPolicy } from '../../src/bot/sim/policies';
import { HERO_ROLLOUT, ROBUST_STICKINESS, setRobustStickiness } from '../../src/bot/strategy/postflop';
import { RANGE_MODEL } from '../../src/bot/ranges/range-model';
import { makePolicy } from './run';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const argN = (f: string, d: number) => Number(argS(f, String(d)));
const SAMPLES = argN('samples', 400);
const jsonFile = argS('json', '');
const emit = (o: unknown) => { if (jsonFile) fs.appendFileSync(jsonFile, JSON.stringify(o) + '\n'); };
const fmt = (r: { bb100: number; ci95: number }) => `${r.bb100 >= 0 ? '+' : ''}${r.bb100.toFixed(1)} ± ${r.ci95.toFixed(1)}`;

type Eng = 'v1' | 'v2';
/** A measured-seat variant. The last three are global switches of the v2 postflop engine, set for the whole run. */
export interface Variant { name: string; pre: Eng; post: Eng; robust?: number; heroRolloutAggression?: number; stickinessShift?: number; exploitWeight?: number }

export const V: Record<string, Variant> = {
  'v1/v1': { name: 'v1/v1', pre: 'v1', post: 'v1' },
  'v1/v2': { name: 'v1/v2', pre: 'v1', post: 'v2' },
  'v2/v1': { name: 'v2/v1', pre: 'v2', post: 'v1' },
  'v2/v2': { name: 'v2/v2', pre: 'v2', post: 'v2' },
};

const A = 'tight-aggressive', LP = 'loose-passive', RE = 'range-equity', CS = 'calling-station', RA = 'range-aware';
export const TABLES: Record<string, string[]> = {
  'hu-tag': [A],
  'hu-re': [RE],
  'hu-ra': [RA],
  'six-indep': [RE, CS, RE, 'random', RE],
  'six-mixed': [RA, A, RE, LP, RA],
  'six-ra': [RA, RA, RA, RA, RA],
};

interface Stats { [k: string]: number }
interface Run { perDeal: number[]; stats: Stats; sawFlopNet: number[]; noFlopNet: number[]; seconds: number }

const R0 = ROBUST_STICKINESS, H0 = HERO_ROLLOUT.aggression, S0 = RANGE_MODEL.stickinessShift;
function applyGlobals(v: Variant): void {
  setRobustStickiness(v.robust ?? R0);
  HERO_ROLLOUT.aggression = v.heroRolloutAggression ?? H0;
  RANGE_MODEL.stickinessShift = v.stickinessShift ?? S0;
}

/** Wrap a policy to count what it does, by street and by whether it faces a bet. */
function counted(p: Policy, stats: Stats): Policy {
  const bump = (k: string) => { stats[k] = (stats[k] ?? 0) + 1; };
  return {
    name: p.name,
    act(view: PolicyView) {
      const c = p.act(view) as { kind: string };
      const s = view.h.street === 'preflop' ? 'pre' : view.h.street;
      bump(`${s}:${view.la.canCheck ? 'free' : 'facing'}:${c.kind}`);
      return c as ReturnType<Policy['act']>;
    },
    observe: p.observe,
  };
}

function heroPolicy(v: Variant, seed: number, deviating = false): Policy {
  const p = botPolicy({ samples: SAMPLES, seed, preflopEngine: v.pre, postflopEngine: v.post, engine: v.post, exploitWeight: v.exploitWeight, name: `bot-${v.name}` });
  return deviating ? makePolicyDeviating(p) : p;
}
// Same rule as deviatingPolicy in src/bot/sim/policies.ts (kept local so the wrapped bot keeps its variant).
function makePolicyDeviating(inner: Policy): Policy {
  return {
    name: `deviating-${inner.name}`,
    act(view) {
      const choice = inner.act(view) as { kind: string; to?: number };
      const { h, la, rng } = view;
      if (h.street === 'preflop' && choice.kind === 'fold' && la.canCall && la.callAmount <= 5 * h.bigBlind && rng.fork(991).next() < 0.5) return { kind: 'call' };
      return choice as ReturnType<Policy['act']>;
    },
    observe: inner.observe,
  };
}

export async function runVariant(v: Variant, field: string[], hands: number, seed: number, deviating = false): Promise<Run> {
  applyGlobals(v);
  const stats: Stats = {};
  const t0 = Date.now();
  const players = [{ playerId: '0', policy: counted(heroPolicy(v, seed, deviating), stats) }, ...field.map((sp, i) => ({ playerId: `${i + 1}`, policy: makePolicy(sp, SAMPLES, seed + i + 1) }))];
  const sawFlopNet: number[] = [], noFlopNet: number[] = [];
  const res = await playSession({
    players, hands, seed, smallBlind: 10, bigBlind: 20, startStack: 2000, duplicate: true,
    onHand: (r) => {
      const seat = r.h.seats.find((x) => x.playerId === '0');
      if (!seat) return;
      const net = (r.nets.get(seat.seat) ?? 0) / r.h.bigBlind;
      const folded = r.h.events.some((e) => e.street === 'preflop' && e.kind === 'fold' && e.seat === seat.seat);
      (r.h.board.length >= 3 && !folded ? sawFlopNet : noFlopNet).push(net);
    },
  });
  applyGlobals({ name: '', pre: 'v2', post: 'v2' });
  return { perDeal: res.totals.get('0')!.perDeal, stats, sawFlopNet, noFlopNet, seconds: (Date.now() - t0) / 1000 };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Shares of each action within a (street, free/facing) group. */
function actionTable(stats: Stats): Record<string, string> {
  const groups = new Map<string, [string, number][]>();
  for (const [k, n] of Object.entries(stats)) { const [s, f, a] = k.split(':'); const g = `${s}:${f}`; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push([a, n]); }
  const out: Record<string, string> = {};
  for (const [g, xs] of [...groups].sort()) { const t = sum(xs.map((x) => x[1])); out[g] = `n=${t} ` + xs.sort().map(([a, n]) => `${a} ${(100 * n / t).toFixed(1)}%`).join(', '); }
  return out;
}

async function factorial(table: string, hands: number, seed: number, deviating: boolean): Promise<void> {
  const field = TABLES[table];
  if (!field) throw new Error(`unknown table ${table}`);
  const n = field.length + 1;
  hands = Math.round(hands / n) * n;
  console.log(`\n## factorial: ${table}${deviating ? ' (Hero makes loose preflop calls)' : ''}, ${hands} hands, seed ${seed}, ${SAMPLES} samples`);
  const runs: Record<string, Run> = {};
  for (const k of ['v1/v1', 'v1/v2', 'v2/v1', 'v2/v2']) {
    runs[k] = await runVariant(V[k], field, hands, seed, deviating);
    const r = runs[k];
    const flopShare = r.sawFlopNet.length / (r.sawFlopNet.length + r.noFlopNet.length);
    console.log(`${k}  ${fmt(bb100(r.perDeal))} bb/100   saw flop ${(100 * flopShare).toFixed(1)}% of hands; net per hand played: flop seen ${(sum(r.sawFlopNet) / (r.sawFlopNet.length + r.noFlopNet.length) * 100).toFixed(1)} bb/100, not seen ${(sum(r.noFlopNet) / (r.sawFlopNet.length + r.noFlopNet.length) * 100).toFixed(1)} bb/100   (${r.seconds.toFixed(0)} s)`);
  }
  const d = (a: string, b: string) => pairedDiff(runs[a].perDeal, runs[b].perDeal);
  const N = runs['v1/v1'].perDeal.length;
  const comb = (w: Record<string, number>) => bb100(Array.from({ length: N }, (_, i) => Object.entries(w).reduce((s, [k, c]) => s + c * runs[k].perDeal[i], 0)));
  const eff = {
    'v2/v2 - v1/v1': d('v2/v2', 'v1/v1'),
    'postflop change alone (v1/v2 - v1/v1)': d('v1/v2', 'v1/v1'),
    'preflop change alone (v2/v1 - v1/v1)': d('v2/v1', 'v1/v1'),
    'postflop main effect': comb({ 'v1/v2': 0.5, 'v2/v2': 0.5, 'v1/v1': -0.5, 'v2/v1': -0.5 }),
    'preflop main effect': comb({ 'v2/v1': 0.5, 'v2/v2': 0.5, 'v1/v1': -0.5, 'v1/v2': -0.5 }),
    'interaction': comb({ 'v2/v2': 1, 'v1/v1': 1, 'v1/v2': -1, 'v2/v1': -1 }),
  };
  for (const [k, r] of Object.entries(eff)) console.log(`  ${k.padEnd(40)} ${fmt(r)}${r.bb100 - r.ci95 > 0 ? '  *' : r.bb100 + r.ci95 < 0 ? '  *' : ''}`);
  const actions: Record<string, Record<string, string>> = {};
  for (const k of Object.keys(runs)) actions[k] = actionTable(runs[k].stats);
  for (const g of Object.keys(actions['v2/v2'])) { console.log(`  ${g}`); for (const k of ['v1/v1', 'v2/v2']) console.log(`     ${k}: ${actions[k][g] ?? '-'}`); }
  emit({ exp: 'factorial', table, deviating, hands, seed, samples: SAMPLES, cells: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, { ...bb100(r.perDeal), sawFlop: r.sawFlopNet.length, noFlop: r.noFlopNet.length, sawFlopNetBB: sum(r.sawFlopNet), noFlopNetBB: sum(r.noFlopNet), seconds: r.seconds }])), effects: eff, actions });
}

async function direct(hands: number, seed: number): Promise<void> {
  hands = Math.round(hands / 6) * 6;
  console.log(`\n## direct: three seats of a variant against three v1/v1 seats, ${hands} hands, seed ${seed}`);
  for (const k of ['v1/v2', 'v2/v1', 'v2/v2']) {
    applyGlobals(V[k]);
    const specs = [k, 'v1/v1', k, 'v1/v1', k, 'v1/v1'];
    const players = specs.map((sp, i) => ({ playerId: `${sp}#${i}`, policy: heroPolicy(V[sp], seed + i) }));
    const res = await playSession({ players, hands, seed, smallBlind: 10, bigBlind: 20, startStack: 2000, duplicate: true });
    const per = players.filter((p) => p.playerId.startsWith(`${k}#`)).map((p) => res.totals.get(p.playerId)!.perDeal);
    const avg = bb100(per[0].map((_, i) => (per[0][i] + per[1][i] + per[2][i]) / 3));
    console.log(`  ${k} seats: ${fmt(avg)} bb/100 per seat${avg.bb100 + avg.ci95 < 0 ? '  * behind v1/v1' : avg.bb100 - avg.ci95 > 0 ? '  * ahead of v1/v1' : ''}`);
    emit({ exp: 'direct', variant: k, hands, seed, samples: SAMPLES, perSeat: avg });
  }
}

async function ablate(table: string, hands: number, seed: number): Promise<void> {
  const field = TABLES[table];
  const n = field.length + 1;
  hands = Math.round(hands / n) * n;
  console.log(`\n## ablation: ${table}, ${hands} hands, seed ${seed}. Preflop v1 throughout, so only the postflop engine differs.`);
  const base: Variant = { name: 'v2 postflop', pre: 'v1', post: 'v2' };
  const variants: Variant[] = [
    { name: 'v1 postflop', pre: 'v1', post: 'v1' },
    base,
    { ...base, name: 'no pessimistic scenario', robust: 0 },
    { ...base, name: "Hero's rollout bluffs like the model", heroRolloutAggression: 0 },
    { ...base, name: 'both of the above', robust: 0, heroRolloutAggression: 0 },
    { ...base, name: 'opponent statistics off', exploitWeight: 0 },
    { name: 'v1 postflop, statistics off', pre: 'v1', post: 'v1', exploitWeight: 0 },
  ];
  const runs: Run[] = [];
  for (const v of variants) {
    const r = await runVariant(v, field, hands, seed);
    runs.push(r);
    const vsV1 = pairedDiff(r.perDeal, runs[0].perDeal), vsV2 = runs.length > 1 ? pairedDiff(r.perDeal, runs[1].perDeal) : null;
    console.log(`  ${v.name.padEnd(40)} ${fmt(bb100(r.perDeal)).padEnd(16)} vs v1 postflop ${fmt(vsV1).padEnd(15)} ${vsV2 ? `vs v2 postflop ${fmt(vsV2)}` : ''}  (${r.seconds.toFixed(0)} s)`);
    emit({ exp: 'ablate', table, variant: v, hands, seed, samples: SAMPLES, result: bb100(r.perDeal), vsV1, vsV2, actions: actionTable(r.stats) });
  }
}

/** Re-run the "Heads-up vs tight-aggressive" row of reports/strategy-bench-2026-11-14 with its exact seeds. */
async function repro(): Promise<void> {
  const ref = JSON.parse(fs.readFileSync('reports/strategy-bench-2026-11-14.json', 'utf8')) as { seed: number; paired: { name: string; hands: number; v2: { bb100: number }; v1: { bb100: number } }[] };
  const idx = ref.paired.findIndex((r) => r.name === 'Heads-up vs tight-aggressive');
  const row = ref.paired[idx];
  const s = ref.seed + 1000 * (idx + 1);
  console.log(`\n## repro: "${row.name}", ${row.hands} hands, session seed ${s}`);
  for (const [spec, key] of [['bot-v1', 'v1'], ['bot', 'v2']] as const) {
    const players = [spec, 'tight-aggressive'].map((sp, i) => ({ playerId: `${i}`, policy: makePolicy(sp, 400, s + i) as Policy }));
    const res = await playSession({ players, hands: row.hands, seed: s, smallBlind: 10, bigBlind: 20, startStack: 2000, duplicate: true });
    const got = bb100(res.totals.get('0')!.perDeal).bb100, want = row[key].bb100;
    console.log(`  ${key}: report ${want.toFixed(6)}  now ${got.toFixed(6)}  ${Math.abs(got - want) < 1e-9 ? 'IDENTICAL' : `differs by ${(got - want).toFixed(3)} bb/100`}`);
    emit({ exp: 'repro', engine: key, report: want, now: got });
  }
}

async function main(): Promise<void> {
  const exp = argS('exp', 'factorial');
  const seed = argN('seed', 4100), hands = argN('hands', 4000);
  if (exp === 'repro') await repro();
  else if (exp === 'direct') await direct(hands, seed);
  else if (exp === 'ablate') await ablate(argS('table', 'hu-tag'), hands, seed);
  else if (exp === 'factorial') await factorial(argS('table', 'hu-tag'), hands, seed, process.argv.includes('--deviating'));
  else throw new Error(`unknown --exp ${exp}`);
}

if (process.argv[1] && /strategy-diag\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
