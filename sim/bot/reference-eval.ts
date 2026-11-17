// ============================================================
// Where do the engines misrank actions? Reference evaluation in the simulator.
//
//   npx tsx sim/bot/reference-eval.ts --table hu-tag [--hands 400] [--seed 7100] [--behave v2|v1]
//        [--samples 300] [--cont-samples 150] [--flop 12] [--rivers 22] [--reps 1] [--json out.json]
//
// The measured seat plays the table with the `--behave` engine. At every postflop decision it reaches, BOTH
// engines are asked for their decision on that exact state, and every candidate action of the version 2 engine
// (plus version 1's choice when it is not among them) is valued by sim/bot/reference.ts under the opponents'
// true policies and everyone's actual cards. After the candidate action the seat continues with version 2 at
// `--cont-samples` (one fixed continuation for every candidate, so the comparison is of THIS decision only).
//
// Reported, in big blinds per decision, with 95% intervals over decision points:
//   1. value of version 2's choice minus value of version 1's choice (paired, same state, same cards);
//   2. for each engine, value of each alternative class of action minus value of the action it chose:
//      a clearly positive number means the engine ranks that alternative too low in that kind of spot;
//   3. the engine's own EV estimate minus the reference value, by class of action (is it optimistic?).
// Single values are clairvoyant (they use hidden cards) and are never reported; only these averages are.
//
// Offline tool. Tables are those of sim/bot/strategy-diag.ts plus the independent opponents.
// ============================================================

import * as fs from 'fs';
import { CardId, Rng, shuffledDeck } from '../../src/bot/cards';
import { BotAgent } from '../../src/bot/agent';
import type { Candidate, Decision } from '../../src/bot/strategy/types';
import { playHand, Policy } from '../../src/bot/sim/table';
import { potTotal } from '../../src/bot/table/engine';
import { makePolicy } from './run';
import { Choice, pairedDiff, referenceValues, RefValue } from './reference';
import { TABLES } from './strategy-diag';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const argN = (f: string, d: number) => Number(argS(f, String(d)));

export const REF_TABLES: Record<string, string[]> = {
  ...TABLES,
  'hu-caller': ['pot-odds-caller'], 'hu-mdf': ['mdf-defender'], 'hu-trapper': ['trapper'], 'hu-maniac': ['maniac'], 'hu-nit': ['nit'], 'hu-punisher': ['adaptive-punisher'],
  'six-independent': ['pot-odds-caller', 'mdf-defender', 'trapper', 'maniac', 'nit'],
  'six-punishers': ['adaptive-punisher', 'trapper', 'mdf-defender', 'adaptive-punisher', 'trapper'],
};

/** Class of an action, from the engine's own label ("bet small (56)" -> "bet small"). */
export function actionClass(c: { action: string; label: string }): string {
  if (c.action === 'check' || c.action === 'fold' || c.action === 'call') return c.action;
  const m = /^(bet|raise)\s+([a-z-]+)/.exec(c.label);
  return m ? `${m[1]} ${m[2]}` : c.action;
}
const aggressive = (cls: string) => cls.startsWith('bet') || cls.startsWith('raise');

export interface RefRow {
  street: string; facing: boolean; opponents: number; bb: number; pot: number; equity: number | null;
  v2: string; v1: string; same: boolean;
  /** Reference value of each engine's choice, in big blinds, and their paired difference. */
  q2: number; q1: number; d21: number;
  /** One entry per candidate: class, reference value (bb), the version 2 engine's own EV estimate (bb) when it gave one. */
  cands: { cls: string; q: number; claimed: number | null; d2: number; d1: number }[];
}

interface Acc { n: number; s: number; ss: number }
const add = (m: Map<string, Acc>, k: string, x: number) => { const a = m.get(k) ?? { n: 0, s: 0, ss: 0 }; a.n++; a.s += x; a.ss += x * x; m.set(k, a); };
const fmt = (a: Acc | undefined, digits = 2): string => {
  if (!a || !a.n) return '–';
  const mean = a.s / a.n;
  if (a.n < 2) return `${mean.toFixed(digits)} (n=1)`;
  const ci = 1.96 * Math.sqrt(Math.max(0, a.ss / a.n - mean * mean) / (a.n - 1));
  const sig = Math.abs(mean) > ci ? ' *' : '';
  return `${mean >= 0 ? '+' : ''}${mean.toFixed(digits)} ± ${ci.toFixed(digits)}${sig} (n=${a.n})`;
};

export async function collect(table: string, hands: number, seed: number, o: { behave: 'v1' | 'v2'; samples: number; contSamples: number; flop: number; rivers: number | 'all'; reps: number; every: number }): Promise<{ rows: RefRow[]; heroNetBB: number; seconds: number }> {
  const field = REF_TABLES[table];
  if (!field) throw new Error(`unknown table ${table}. Known: ${Object.keys(REF_TABLES).join(', ')}`);
  const n = field.length + 1;
  const v2 = new BotAgent({ seed, engine: 'v2' }), v1 = new BotAgent({ seed: seed + 17, engine: 'v1' });
  const cont = new BotAgent({ seed: seed + 31, engine: 'v2' });
  const others = field.map((sp, i) => makePolicy(sp, o.samples, seed + i + 1));
  const rows: RefRow[] = [];
  let holes: Map<number, [CardId, CardId]> = new Map();
  let policiesBySeat = new Map<number, Policy>();
  let decisionNo = 0;
  const continuation: Policy = { name: 'continuation-v2', act: (v) => { const d = cont.decideSync(v.h, v.seat, v.hole, o.contSamples); return { kind: d.action, to: d.to }; } };

  const hero: Policy = {
    name: `measured-${o.behave}`,
    async act(view) {
      const d2: Decision = v2.decideSync(view.h, view.seat, view.hole, o.samples);
      const d1: Decision = v1.decideSync(view.h, view.seat, view.hole, o.samples);
      const mine = o.behave === 'v2' ? d2 : d1;
      if (view.h.street !== 'preflop' && decisionNo++ % o.every === 0) {
        const key = (c: { action: string; to?: number }) => `${c.action}:${c.to ?? ''}`;
        const cands: Candidate[] = d2.candidates.slice();
        if (!cands.some((c) => key(c) === key(d1))) cands.push({ action: d1.action, to: d1.to, label: d1.label, ev: null, evSe: null, freq: 0 });
        if (!cands.some((c) => key(c) === key(d2))) cands.push({ action: d2.action, to: d2.to, label: d2.label, ev: null, evSe: null, freq: 0 });
        // The continuation agent knows what the measured seat has learned about the others, nothing more.
        for (const [k, p] of v2.profiles) cont.profiles.set(k, p);
        const actions: Choice[] = cands.map((c) => ({ kind: c.action, to: c.to }));
        const ref: RefValue[] = await referenceValues({ h: view.h, heroSeat: view.seat, holes, policies: policiesBySeat, continuation }, actions, { seed: seed * 7919 + decisionNo, flopRunouts: o.flop, turnRivers: o.rivers, reps: o.reps });
        const bb = view.h.bigBlind;
        const i2 = cands.findIndex((c) => key(c) === key(d2)), i1 = cands.findIndex((c) => key(c) === key(d1));
        rows.push({
          street: view.h.street, facing: !view.la.canCheck, opponents: view.h.seats.filter((s) => s.dealtIn && !s.folded).length - 1, bb, pot: potTotal(view.h) / bb,
          equity: d2.equity?.equity ?? null, v2: actionClass(d2), v1: actionClass(d1), same: i1 === i2,
          q2: ref[i2].mean / bb, q1: ref[i1].mean / bb, d21: pairedDiff(ref[i2], ref[i1]).mean / bb,
          cands: cands.map((c, i) => ({ cls: actionClass(c), q: ref[i].mean / bb, claimed: c.ev === null ? null : c.ev / bb, d2: pairedDiff(ref[i], ref[i2]).mean / bb, d1: pairedDiff(ref[i], ref[i1]).mean / bb })),
        });
      }
      return { kind: mine.action, to: mine.to };
    },
    observe(h, reveals) { v2.observeHand(h, reveals); v1.observeHand(h, reveals); },
  };

  const rng = new Rng(seed);
  const t0 = Date.now();
  let net = 0;
  for (let i = 0; i < hands; i++) {
    const deck = shuffledDeck(rng);
    const dealSeed = rng.int(1 << 30);
    // The measured seat moves round the table so that it plays every position.
    const heroSeat = i % n;
    const seats = Array.from({ length: n }, (_, s) => {
      const k = (s - heroSeat + n) % n;
      return { seat: s, playerId: k === 0 ? 'hero' : `opp${k}`, policy: k === 0 ? hero : others[k - 1], stack: 2000 };
    });
    policiesBySeat = new Map(seats.filter((s) => s.seat !== heroSeat).map((s) => [s.seat, s.policy]));
    const res = await playHand({ handId: `ref-${seed}-${i}`, seats, buttonSeat: Math.floor(i / n) % n, smallBlind: 10, bigBlind: 20, tableSeats: Math.max(n, 2), deck, seed: dealSeed, onStep: (_h, hs) => { holes = hs; } });
    net += (res.nets.get(heroSeat) ?? 0) / 20;
  }
  return { rows, heroNetBB: net, seconds: (Date.now() - t0) / 1000 };
}

export function report(table: string, rows: RefRow[]): string[] {
  const out: string[] = [];
  const spotKey = (r: RefRow) => `${r.street}, ${r.facing ? 'facing a bet' : 'checked to'}`;
  // 1. version 2 against version 1 on the same states.
  const d = new Map<string, Acc>(), differ = new Map<string, Acc>();
  for (const r of rows) { for (const k of ['all postflop', r.street]) { add(d, k, r.d21); add(differ, k, r.same ? 0 : 1); if (!r.same) add(d, `${k} | where they differ`, r.d21); } }
  out.push(`### ${table}: value of version 2's choice minus version 1's choice (bb per decision, same state and cards)`, '',
    '| Decisions | All | Share where the two differ | Only where they differ |', '|---|---|---|---|');
  for (const k of ['all postflop', 'flop', 'turn', 'river']) out.push(`| ${k} | ${fmt(d.get(k), 3)} | ${differ.get(k) ? `${(100 * (differ.get(k) as Acc).s / (differ.get(k) as Acc).n).toFixed(0)}%` : '–'} | ${fmt(d.get(`${k} | where they differ`), 3)} |`);

  // 2. alternatives against the chosen action.
  for (const eng of ['v2', 'v1'] as const) {
    const m = new Map<string, Acc>(), chosen = new Map<string, Acc>();
    const classes = new Set<string>();
    for (const r of rows) {
      const best = new Map<string, number>();        // one value per class per decision: the best-valued size is NOT picked (that would be clairvoyant); sizes are separate classes
      for (const c of r.cands) best.set(c.cls, eng === 'v2' ? c.d2 : c.d1);
      for (const [cls, x] of best) { add(m, `${spotKey(r)}|${cls}`, x); classes.add(cls); }
      add(chosen, `${spotKey(r)}|${eng === 'v2' ? r.v2 : r.v1}`, 1);
      add(chosen, spotKey(r), 1);
      // Aggregate: any passive option against any aggressive one is not defined per decision, so report "most passive" explicitly.
      const passive = r.cands.find((c) => c.cls === 'check') ?? r.cands.find((c) => c.cls === 'call');
      if (passive) add(m, `${spotKey(r)}|(check or call)`, eng === 'v2' ? passive.d2 : passive.d1);
    }
    const order = ['fold', 'check', 'call', 'bet small', 'bet medium', 'bet large', 'bet overbet', 'bet all-in', 'raise small', 'raise medium', 'raise large', 'raise all-in'];
    const cols = [...classes].sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
    out.push('', `### ${table}: version ${eng.slice(1)}: value of each alternative minus value of the action chosen (bb per decision)`, '',
      'Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.', '',
      `| Spot | n | Chose (share) | ${cols.join(' | ')} |`, `|---|---|---|${cols.map(() => '---').join('|')}|`);
    const spots = [...new Set(rows.map(spotKey))].sort((a, b) => ['flop', 'turn', 'river'].indexOf(a.split(',')[0]) - ['flop', 'turn', 'river'].indexOf(b.split(',')[0]) || a.localeCompare(b));
    for (const s of spots) {
      const total = (chosen.get(s) as Acc).n;
      const share = cols.filter((c) => chosen.get(`${s}|${c}`)).map((c) => `${c} ${(100 * (chosen.get(`${s}|${c}`) as Acc).n / total).toFixed(0)}%`).join(', ');
      out.push(`| ${s} | ${total} | ${share} | ${cols.map((c) => fmt(m.get(`${s}|${c}`))).join(' | ')} |`);
    }
  }

  // 3. the version 2 engine's own estimates.
  const cal = new Map<string, Acc>();
  for (const r of rows) for (const c of r.cands) if (c.claimed !== null) { add(cal, aggressive(c.cls) ? 'bets and raises' : c.cls, c.claimed - c.q); add(cal, `${r.street}|${aggressive(c.cls) ? 'bets and raises' : c.cls}`, c.claimed - c.q); }
  out.push('', `### ${table}: version 2's own EV estimate minus the reference value (bb; positive = the engine is optimistic)`, '',
    '| Action | All streets | Flop | Turn | River |', '|---|---|---|---|---|');
  for (const k of ['check', 'call', 'bets and raises']) out.push(`| ${k} | ${fmt(cal.get(k))} | ${fmt(cal.get(`flop|${k}`))} | ${fmt(cal.get(`turn|${k}`))} | ${fmt(cal.get(`river|${k}`))} |`);
  return out;
}

async function main(): Promise<void> {
  const table = argS('table', 'hu-tag');
  const hands = argN('hands', 400), seed = argN('seed', 7100);
  const rivers = argS('rivers', '22');
  const o = { behave: argS('behave', 'v2') as 'v1' | 'v2', samples: argN('samples', 300), contSamples: argN('cont-samples', 150), flop: argN('flop', 12), rivers: rivers === 'all' ? 'all' as const : Number(rivers), reps: argN('reps', 1), every: argN('every', 1) };
  const lines: string[] = [];
  for (const t of table.split(',')) {
    const r = await collect(t, hands, seed, o);
    const head = `## ${t} (${REF_TABLES[t].join(', ')}): ${hands} hands, seed ${seed}, measured seat plays ${o.behave}; ${r.rows.length} postflop decisions valued in ${Math.round(r.seconds)} s`;
    const body = [head, '', `Settings: engine ${o.samples} samples, continuation version 2 at ${o.contSamples} samples, flop ${o.flop} run-outs, turn ${o.rivers} rivers, ${o.reps} repetition(s). Measured seat's result in the session itself: ${(100 * r.heroNetBB / hands).toFixed(1)} bb/100 (one unpaired run; not a benchmark).`, '', ...report(t, r.rows), ''];
    console.log(body.join('\n'));
    lines.push(...body);
    const json = argS('json', '');
    if (json) fs.writeFileSync(json.replace(/\.json$/, `-${t}.json`), JSON.stringify({ table: t, hands, seed, options: o, rows: r.rows }));
  }
  const outFile = argS('out', '');
  if (outFile) fs.writeFileSync(outFile, lines.join('\n') + '\n');
}

if (process.argv[1] && /reference-eval\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
