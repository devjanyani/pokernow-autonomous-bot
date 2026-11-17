// ============================================================
// The existing PokerBench-trained model against version 1 and version 2, offline.
//
//   npx tsx sim/bot/ml-compare.ts [--tables six-independent,hu-re] [--hands 1500] [--seed 9300] [--every 2]
//        [--river-hands 3000] [--out report.md]
//
// EXPERIMENTAL. The model is not used by the active bot and this tool does not change that.
//
// Four separate questions, answered separately:
//   1. Is the model loaded correctly?        Its agreement with the held-out PokerBench rows is recomputed.
//   2. Are its inputs built correctly?       On every simulated spot the action mask the model applies must equal
//                                            the rules engine's legal actions, and its action must be legal.
//   3. Is it being asked familiar questions? Feature-by-feature comparison of the simulated spots with the
//                                            held-out rows, and the share of spots outside the training setting.
//   4. How do its actions compare?           (a) how often it names the same class of action as each engine;
//                                            (b) the value of its action minus the engine's under the simulated
//                                                opponents' true policies (sim/bot/reference.ts), paired;
//                                            (c) its loss against the river solver reference.
// None of this is evidence about play against people, and agreement with solver labels is not profit.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { CardId, Rng, shuffledDeck } from '../../src/bot/cards';
import { BotAgent } from '../../src/bot/agent';
import { playHand, Policy } from '../../src/bot/sim/table';
import type { Spot } from '../../src/core/ml/features';
import { predictPostflop, MODEL_ACCURACY } from '../../src/core/ml/policy';
import { maskMatchesRules, mlAdvice, mlSpot, shiftReport } from './ml-adapter';
import { actionClass, REF_TABLES } from './reference-eval';
import { Choice, pairedDiff, referenceValues } from './reference';
import { collectSpots, evaluateSpot, riverReport, SpotResult } from './river-compare';
import { makePolicy } from './run';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const argN = (f: string, d: number) => Number(argS(f, String(d)));
interface Acc { n: number; s: number; ss: number }
const add = (m: Map<string, Acc>, k: string, x: number) => { const a = m.get(k) ?? { n: 0, s: 0, ss: 0 }; a.n++; a.s += x; a.ss += x * x; m.set(k, a); };
const fmt = (a: Acc | undefined, digits = 2, pct = false): string => {
  if (!a || !a.n) return '–';
  const mean = a.s / a.n, half = a.n > 1 ? 1.96 * Math.sqrt(Math.max(0, a.ss / a.n - mean * mean) / (a.n - 1)) : 0;
  if (pct) return `${(100 * mean).toFixed(0)}% ± ${(100 * half).toFixed(0)} (n=${a.n})`;
  return `${mean >= 0 ? '+' : ''}${mean.toFixed(digits)} ± ${half.toFixed(digits)}${Math.abs(mean) > half && a.n > 1 ? ' *' : ''} (n=${a.n})`;
};

/** Agreement of the loaded model with the held-out PokerBench rows shipped as a test fixture. */
export function holdoutAgreement(): { rows: number; agreement: number; spots: Spot[] } {
  const rows = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/postflop-holdout.json'), 'utf8')) as (Spot & { label: number })[];
  const names = ['fold', 'check', 'call', 'bet', 'raise'];
  let ok = 0;
  for (const r of rows) if (predictPostflop(r).action === names[r.label]) ok++;
  return { rows: rows.length, agreement: ok / rows.length, spots: rows };
}

interface Row { table: string; street: string; inside: boolean; ml: string; v2: string; v1: string; dML2: number | null; dML1: number | null; d21: number | null; maskOk: boolean; legal: boolean }

async function collect(table: string, hands: number, seed: number, every: number, spots: Spot[], reasons: Map<string, number>): Promise<{ rows: Row[]; multiway: number; total: number }> {
  const field = REF_TABLES[table];
  const n = field.length + 1;
  const v2 = new BotAgent({ seed, engine: 'v2' }), v1 = new BotAgent({ seed: seed + 17, engine: 'v1' }), cont = new BotAgent({ seed: seed + 31, engine: 'v2' });
  const others = field.map((sp, i) => makePolicy(sp, 300, seed + i + 1));
  const continuation: Policy = { name: 'continuation-v2', act: (v) => { const d = cont.decideSync(v.h, v.seat, v.hole, 150); return { kind: d.action, to: d.to }; } };
  const rows: Row[] = [];
  let holes: Map<number, [CardId, CardId]> = new Map(), policies = new Map<number, Policy>(), count = 0, multiway = 0, total = 0;
  const hero: Policy = {
    name: 'measured-v2',
    async act(view) {
      const d2 = v2.decideSync(view.h, view.seat, view.hole, 300);
      if (view.h.street !== 'preflop') {
        total++;
        const m = mlSpot(view.h, view.seat, view.hole, view.la);
        if (!m) multiway++;
        else {
          const adv = mlAdvice(view.h, view.seat, view.hole, view.la)!;
          const d1 = v1.decideSync(view.h, view.seat, view.hole, 300);
          spots.push(m.spot);
          for (const r of m.outside) reasons.set(r.replace(/\d+ bb/, 'N bb'), (reasons.get(r.replace(/\d+ bb/, 'N bb')) ?? 0) + 1);
          const legal = adv.action === 'fold' ? !view.la.canCheck : adv.action === 'check' ? view.la.canCheck : adv.action === 'call' ? view.la.canCall : view.la.canRaise && (adv.to as number) >= view.la.minRaiseTo - 1e-9 && (adv.to as number) <= view.la.maxRaiseTo + 1e-9;
          const row: Row = { table, street: view.h.street, inside: m.outside.length === 0, ml: adv.action, v2: d2.action, v1: d1.action, dML2: null, dML1: null, d21: null, maskOk: maskMatchesRules(m.spot, view.la), legal };
          if (legal && count++ % every === 0) {
            for (const [k, p] of v2.profiles) cont.profiles.set(k, p);
            const acts: Choice[] = [{ kind: adv.action, to: adv.to }, { kind: d2.action, to: d2.to }, { kind: d1.action, to: d1.to }];
            const ref = await referenceValues({ h: view.h, heroSeat: view.seat, holes, policies, continuation }, acts, { seed: seed * 31 + count, flopRunouts: 12, turnRivers: 22, reps: 1 });
            const bb = view.h.bigBlind;
            row.dML2 = pairedDiff(ref[0], ref[1]).mean / bb; row.dML1 = pairedDiff(ref[0], ref[2]).mean / bb; row.d21 = pairedDiff(ref[1], ref[2]).mean / bb;
          }
          rows.push(row);
        }
      }
      return { kind: d2.action, to: d2.to };
    },
    observe(h, reveals) { v2.observeHand(h, reveals); v1.observeHand(h, reveals); },
  };
  const rng = new Rng(seed);
  for (let i = 0; i < hands; i++) {
    const deck = shuffledDeck(rng);
    const heroSeat = i % n;
    const seats = Array.from({ length: n }, (_, s) => { const k = (s - heroSeat + n) % n; return { seat: s, playerId: k === 0 ? 'hero' : `opp${k}`, policy: k === 0 ? hero : others[k - 1], stack: 2000 }; });
    policies = new Map(seats.filter((s) => s.seat !== heroSeat).map((s) => [s.seat, s.policy]));
    await playHand({ handId: `ml-${seed}-${i}`, seats, buttonSeat: Math.floor(i / n) % n, smallBlind: 10, bigBlind: 20, tableSeats: Math.max(n, 2), deck, seed: rng.int(1 << 30), onStep: (_h, hs) => { holes = hs; } });
  }
  return { rows, multiway, total };
}

async function main(): Promise<void> {
  const tables = argS('tables', 'six-independent,hu-re').split(',');
  const hands = argN('hands', 1500), seed = argN('seed', 9300), every = argN('every', 2), riverHands = argN('river-hands', 3000);
  const L: string[] = ['## The existing PokerBench model against version 1 and version 2 (offline, experimental)', ''];
  const hold = holdoutAgreement();
  L.push('### 1. Is the model loaded correctly?', '',
    `Agreement with the ${hold.rows} held-out PokerBench rows in \`tests/fixtures/postflop-holdout.json\`: ${(100 * hold.agreement).toFixed(1)}%. Recorded when it was trained: ${(100 * MODEL_ACCURACY.test).toFixed(1)}% on the full test set.`, '');

  const simSpots: Spot[] = [];
  const reasons = new Map<string, number>();
  const rows: Row[] = [];
  let multiway = 0, total = 0;
  for (const t of tables) { const r = await collect(t, hands, seed, every, simSpots, reasons); rows.push(...r.rows); multiway += r.multiway; total += r.total; console.error(`${t}: ${r.rows.length} heads-up postflop decisions`); }

  L.push('### 2. Are its inputs built correctly?', '',
    `Simulated postflop decisions of the measured seat: ${total} (${tables.join(', ')}; ${hands} hands each, seed ${seed}). With more than two players still in: ${multiway} (${(100 * multiway / Math.max(1, total)).toFixed(0)}%); the model has no such training rows and is not asked.`,
    `Heads-up decisions given to the model: ${rows.length}. Action mask equal to the rules engine's legal actions: ${rows.filter((r) => r.maskOk).length} of ${rows.length}. Model action legal: ${rows.filter((r) => r.legal).length} of ${rows.length}.`, '');

  L.push('### 3. Is it being asked familiar questions?', '',
    `Decisions inside the training setting (six-handed table, raised pot, about 100 big blinds, nobody all-in): ${rows.filter((r) => r.inside).length} of ${rows.length}. Reasons the others fall outside (a decision can have several):`, '',
    ...[...reasons].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${n} × ${k}`), '',
    'Model inputs whose distribution differs most between the held-out PokerBench rows and the simulated decisions (difference of means in standard deviations of the held-out rows; share of simulated decisions outside the range the held-out rows cover):', '',
    '| Input | Held-out mean | Simulated mean | Difference (sd) | Outside the held-out range |', '|---|---|---|---|---|',
    ...shiftReport(hold.spots, simSpots).filter((r) => Math.abs(r.smd) >= 0.4 || r.outOfRange >= 0.02).sort((a, b) => Math.abs(b.smd) - Math.abs(a.smd)).slice(0, 14)
      .map((r) => `| ${r.feature} | ${r.reference.toFixed(2)} | ${r.sample.toFixed(2)} | ${Number.isFinite(r.smd) ? (r.smd >= 0 ? '+' : '') + r.smd.toFixed(2) : 'not present in training'} | ${(100 * r.outOfRange).toFixed(0)}% |`), '',
    'Not among the inputs at all, so no shift can be measured: stack depth, number of players at the table, sizes of earlier bets, anything about the opponent.', '');

  const m = new Map<string, Acc>();
  for (const r of rows) {
    for (const scope of ['all', r.inside ? 'inside the training setting' : 'outside it', r.street]) {
      add(m, `${scope}|ml=v2`, r.ml === r.v2 ? 1 : 0); add(m, `${scope}|ml=v1`, r.ml === r.v1 ? 1 : 0); add(m, `${scope}|v2=v1`, r.v2 === r.v1 ? 1 : 0);
      const agg = (a: string) => (a === 'bet' || a === 'raise' ? 1 : 0);
      add(m, `${scope}|agg ml`, agg(r.ml)); add(m, `${scope}|agg v2`, agg(r.v2)); add(m, `${scope}|agg v1`, agg(r.v1));
      if (r.dML2 !== null) { add(m, `${scope}|dML2`, r.dML2); add(m, `${scope}|dML1`, r.dML1 as number); add(m, `${scope}|d21`, r.d21 as number); }
    }
  }
  const scopes = ['all', 'inside the training setting', 'outside it', 'flop', 'turn', 'river'];
  L.push('### 4a. Same class of action?', '', '| Decisions | Model = version 2 | Model = version 1 | Version 2 = version 1 | Model bets or raises | Version 2 bets or raises | Version 1 bets or raises |', '|---|---|---|---|---|---|---|',
    ...scopes.map((s) => `| ${s} | ${fmt(m.get(`${s}|ml=v2`), 0, true)} | ${fmt(m.get(`${s}|ml=v1`), 0, true)} | ${fmt(m.get(`${s}|v2=v1`), 0, true)} | ${fmt(m.get(`${s}|agg ml`), 0, true)} | ${fmt(m.get(`${s}|agg v2`), 0, true)} | ${fmt(m.get(`${s}|agg v1`), 0, true)} |`), '',
    '### 4b. Value under the simulated opponents\' true policies (bb per decision, paired on the same state and cards)', '',
    'After the action every adviser\'s line is continued by version 2, so only this one decision differs. * marks an interval that excludes zero.', '',
    '| Decisions | Model minus version 2 | Model minus version 1 | Version 2 minus version 1 |', '|---|---|---|---|',
    ...scopes.map((s) => `| ${s} | ${fmt(m.get(`${s}|dML2`))} | ${fmt(m.get(`${s}|dML1`))} | ${fmt(m.get(`${s}|d21`))} |`), '');

  // 4c. river solver reference, heads-up tables only.
  const results: SpotResult[] = [];
  let dropped = 0;
  for (const t of ['hu-re', 'hu-trapper', 'hu-tag', 'hu-mdf']) {
    const sp = await collectSpots(t, riverHands, seed + 50, 400, { model: ({ h, seat, hole, la }) => { const a = mlAdvice(h, seat, hole, la); return a ? { action: a.action, to: a.to, label: a.label } : null; } });
    for (const s of sp) { const r = evaluateSpot(s, 140); if (!r || r.exploitPotShare > 0.01) { dropped++; continue; } results.push(r); }
    console.error(`${t}: ${results.length} river spots so far`);
  }
  L.push('### 4c. River decisions against the solver reference', '',
    `Heads-up tables hu-re, hu-trapper, hu-tag, hu-mdf; ${riverHands} hands each, seed ${seed + 50}. Ranges are version 2's own beliefs; the reference is an approximate equilibrium of the one-street river game (see \`sim/bot/river-reference.ts\`), not a solution of the whole hand. Every one of these spots is outside the model's training setting (heads-up table).`, '',
    ...riverReport(results, dropped, 0.01, ['v1', 'v2', 'model']));
  console.log(L.join('\n'));
  const out = argS('out', '');
  if (out) fs.writeFileSync(out, L.join('\n') + '\n');
}

if (process.argv[1] && /ml-compare\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
