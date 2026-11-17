// ============================================================
// Version 1 and version 2 (and, optionally, other advisers) against the river reference.
//
//   npx tsx sim/bot/river-compare.ts [--tables hu-re,hu-trapper,hu-tag] [--hands 1500] [--seed 9100]
//        [--max-spots 150] [--cap 140] [--out report.md] [--json spots.json]
//
// 1. Heads-up hands are played in the simulator (the measured seat plays version 2). Every river decision
//    that is the seat's first on that street (checked to, first to act, or facing one bet) becomes a spot.
// 2. For each spot the ranges are the ones the version 2 engine itself assigns: the other player's range
//    from the action so far, and the range it believes the other player gives Hero. The bet sizes offered to
//    Hero are the engine's own candidate sizes; the other player may use the same fractions of the pot.
// 3. The one-street game is solved (sim/bot/river-reference.ts) and recomputed independently. Spots whose
//    solution a best-responder could beat by more than `--tolerance` of the pot are dropped and counted.
// 4. Each adviser's action for Hero's actual hand is priced against the solution: the value of taking that
//    action and then playing as well as possible against the solution's strategy for the other player, minus
//    the same for the best action. That loss is zero for an equilibrium action and positive otherwise.
//
// Reading the result. The loss says how much an opponent who plays the equilibrium OF THIS RIVER GAME takes
// from the action. It does not say the action loses against the simulated or any real opponent, and the
// ranges are the engine's beliefs, not known truths. See the header of river-reference.ts.
// ============================================================

import * as fs from 'fs';
import { CardId, COMBO_HI, COMBO_LO, NUM_COMBOS, Rng, shuffledDeck } from '../../src/bot/cards';
import { BotAgent } from '../../src/bot/agent';
import type { Range } from '../../src/bot/ranges/range';
import { playHand, Policy } from '../../src/bot/sim/table';
import { buildTable, FeatureCache } from '../../src/bot/strategy/villains';
import type { Decision } from '../../src/bot/strategy/types';
import { cloneHand, HandState, LegalActions, potTotal, seatOf } from '../../src/bot/table/engine';
import type { RangeHand } from '../../src/core/solver/postflop-cfr';
import { REF_TABLES } from './reference-eval';
import { independentCheck, RiverSpec, solveRiver } from './river-reference';
import { makePolicy } from './run';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const argN = (f: string, d: number) => Number(argS(f, String(d)));

export interface RiverSpot {
  table: string; h: HandState; seat: number; hole: [CardId, CardId]; la: LegalActions;
  pot: number; toCall: number; heroIsIP: boolean; bb: number;
  advice: Record<string, { action: string; to?: number; label: string }>;
  /** Hero candidate bet sizes as chips added. */
  sizes: number[];
}

/** An adviser is anything that names an action for the measured seat: an engine, a model, a rule. */
export type Adviser = (spot: { h: HandState; seat: number; hole: [CardId, CardId]; la: LegalActions }) => { action: string; to?: number; label: string } | null;

/** The weighted hands of a range, strongest weights first, at most `cap` of them, never touching `dead`. */
export function toRangeHands(r: Range, dead: readonly CardId[], cap: number, must?: [CardId, CardId]): RangeHand[] {
  const d = new Set(dead);
  let out: RangeHand[] = [];
  let max = 0;
  for (let i = 0; i < NUM_COMBOS; i++) if (r[i] > max && !d.has(COMBO_LO[i] as CardId) && !d.has(COMBO_HI[i] as CardId)) max = r[i];
  for (let i = 0; i < NUM_COMBOS; i++) {
    const a = COMBO_LO[i] as CardId, b = COMBO_HI[i] as CardId;
    if (d.has(a) || d.has(b) || !(r[i] > 0.01 * max)) continue;
    out.push({ cards: [a, b], weight: r[i] });
  }
  out.sort((x, y) => y.weight - x.weight);
  out = out.slice(0, cap);
  if (must && !out.some((x) => (x.cards[0] === must[0] && x.cards[1] === must[1]) || (x.cards[0] === must[1] && x.cards[1] === must[0]))) {
    const mean = out.reduce((s, x) => s + x.weight, 0) / Math.max(1, out.length);
    out.push({ cards: must, weight: mean || 1 });
  }
  return out;
}

export async function collectSpots(table: string, hands: number, seed: number, samples: number, advisers: Record<string, Adviser>): Promise<RiverSpot[]> {
  const field = REF_TABLES[table];
  if (!field || field.length !== 1) throw new Error(`river-compare needs a heads-up table; "${table}" is not one`);
  const v2 = new BotAgent({ seed, engine: 'v2' }), v1 = new BotAgent({ seed: seed + 17, engine: 'v1' });
  const other = makePolicy(field[0], samples, seed + 1);
  const spots: RiverSpot[] = [];
  const hero: Policy = {
    name: 'measured-v2',
    act(view) {
      const d2: Decision = v2.decideSync(view.h, view.seat, view.hole, samples);
      const me = seatOf(view.h, view.seat);
      const acted = view.h.events.some((e) => e.street === 'river' && e.seat === view.seat);
      if (view.h.street === 'river' && !acted && me.streetCommit === 0 && view.h.raisesThisStreet <= 1 && me.stack > 0) {
        const d1 = v1.decideSync(view.h, view.seat, view.hole, samples);
        const villain = view.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== view.seat);
        if (villain && !villain.allIn) {
          const toCall = view.la.callAmount;
          const villainActed = view.h.events.some((e) => e.street === 'river' && e.seat === villain.seat);
          const advice: RiverSpot['advice'] = { v2: { action: d2.action, to: d2.to, label: d2.label }, v1: { action: d1.action, to: d1.to, label: d1.label } };
          const h = cloneHand(view.h);
          for (const [name, a] of Object.entries(advisers)) { const x = a({ h, seat: view.seat, hole: view.hole, la: view.la }); if (x) advice[name] = x; }
          spots.push({
            table, h, seat: view.seat, hole: view.hole, la: view.la, pot: potTotal(view.h) - toCall, toCall, heroIsIP: villainActed, bb: view.h.bigBlind, advice,
            sizes: d2.candidates.filter((c) => c.action === 'bet' || c.action === 'raise').map((c) => (c.to as number) - me.streetCommit),
          });
        }
      }
      return { kind: d2.action, to: d2.to };
    },
    observe(h, reveals) { v2.observeHand(h, reveals); v1.observeHand(h, reveals); },
  };
  const rng = new Rng(seed);
  for (let i = 0; i < hands; i++) {
    const deck = shuffledDeck(rng);
    const heroSeat = i % 2;
    const seats = [0, 1].map((s) => ({ seat: s, playerId: s === heroSeat ? 'hero' : 'opp', policy: s === heroSeat ? hero : other, stack: 2000 }));
    await playHand({ handId: `rv-${seed}-${i}`, seats, buttonSeat: Math.floor(i / 2) % 2, smallBlind: 10, bigBlind: 20, tableSeats: 2, deck, seed: rng.int(1 << 30) });
  }
  return spots;
}

export interface SpotResult {
  table: string; facing: boolean; potBB: number; exploitPotShare: number; iterations: number; checkDiff: number;
  /** The solution's probabilities for Hero's actual hand, by class of action. */
  solution: Record<string, number>;
  /** Per adviser: class of its action and its loss against the solution, in big blinds. */
  advice: Record<string, { cls: string; lossBB: number; probInSolution: number }>;
}

const cache = new FeatureCache();
export function evaluateSpot(s: RiverSpot, cap: number): SpotResult | null {
  const t = buildTable(s.h, s.seat, s.hole, new Map(), 0, cache);
  if (t.villains.length !== 1) return null;
  const me = seatOf(s.h, s.seat), v = seatOf(s.h, t.villains[0].seat);
  const hero = toRangeHands(t.heroPerceived, s.h.board, cap, s.hole);
  const villain = toRangeHands(t.villains[0].range, s.h.board, cap);
  if (hero.length < 2 || villain.length < 2) return null;
  const stack = Math.min(me.stack, v.stack + v.streetCommit);
  const pot = s.pot;
  // Hero's sizes are the engine's candidates. When Hero faces a bet, a raise of r chips adds r - toCall beyond the call.
  const fr = [...new Set(s.sizes.map((x) => Math.round(100 * (s.toCall > 0 ? (x - s.toCall) / (pot + 2 * s.toCall) : x / pot)) / 100).filter((f) => f > 0.05))].sort((a, b) => a - b);
  const spec: RiverSpec = { board: s.h.board, hero, villain, pot, stack, toCall: s.toCall, heroIsIP: s.heroIsIP, betFractions: s.toCall > 0 ? [0.5, 1] : fr.length ? fr : [0.5, 1], raiseFractions: s.toCall > 0 && fr.length ? fr.slice(0, 2) : [0.75] };
  let sol;
  try { sol = solveRiver(spec, { maxIterations: 1200, targetPotShare: 0.003 }); } catch { return null; }
  const chk = independentCheck(sol, spec);
  const i = sol.solver.hands[0].findIndex((c) => (c[0] === s.hole[0] && c[1] === s.hole[1]) || (c[0] === s.hole[1] && c[1] === s.hole[0]));
  if (i < 0) return null;
  const root = sol.solver.root;
  const values = root.actions.map((_, a) => chk.actionValues[a][i]);
  if (values.some((x) => !Number.isFinite(x))) return null;
  const best = Math.max(...values);
  const clsOf = (a: { kind: string; potFraction: number }) => (a.kind === 'fold' || a.kind === 'check' || a.kind === 'call' ? a.kind : s.toCall > 0 ? 'raise' : a.potFraction < 0.45 ? 'bet small' : a.potFraction < 0.85 ? 'bet medium' : 'bet large or more');
  const solution: Record<string, number> = {};
  root.actions.forEach((a, k) => { const c = clsOf(a); solution[c] = (solution[c] ?? 0) + chk.actionProbs[k][i]; });
  const advice: SpotResult['advice'] = {};
  for (const [name, a] of Object.entries(s.advice)) {
    let k: number;
    if (a.action === 'fold' || a.action === 'check' || a.action === 'call') k = root.actions.findIndex((x) => x.kind === a.action);
    else {
      const chips = (a.to as number) - me.streetCommit;
      const idx = root.actions.map((x, n) => ({ x, n })).filter(({ x }) => x.kind === 'bet' || x.kind === 'raise' || x.kind === 'allin');
      if (!idx.length) continue;
      k = idx.sort((p, q) => Math.abs(p.x.chips - chips) - Math.abs(q.x.chips - chips))[0].n;
    }
    if (k < 0) continue;
    advice[name] = { cls: clsOf(root.actions[k]), lossBB: (best - values[k]) / s.bb, probInSolution: chk.actionProbs[k][i] };
  }
  return { table: s.table, facing: s.toCall > 0, potBB: pot / s.bb, exploitPotShare: chk.exploitChips / pot, iterations: sol.iterations, checkDiff: chk.maxValueDiff, solution, advice };
}

interface Acc { n: number; s: number; ss: number }
const add = (m: Map<string, Acc>, k: string, x: number) => { const a = m.get(k) ?? { n: 0, s: 0, ss: 0 }; a.n++; a.s += x; a.ss += x * x; m.set(k, a); };
const ci = (a: Acc | undefined, digits = 2, pct = false): string => {
  if (!a || !a.n) return '–';
  const mean = a.s / a.n, half = a.n > 1 ? 1.96 * Math.sqrt(Math.max(0, a.ss / a.n - mean * mean) / (a.n - 1)) : 0;
  return pct ? `${(100 * mean).toFixed(0)}% ± ${(100 * half).toFixed(0)}` : `${mean.toFixed(digits)} ± ${half.toFixed(digits)}`;
};

export function riverReport(results: SpotResult[], dropped: number, tolerance: number, names: string[]): string[] {
  const out: string[] = [];
  const ex = results.map((r) => r.exploitPotShare).sort((a, b) => a - b);
  out.push(`${results.length} river spots solved (${dropped} dropped: no usable ranges, or the solution could be beaten by more than ${(100 * tolerance).toFixed(1)}% of the pot).`,
    `Quality of the solutions used: a best-responder gains a median of ${(100 * ex[Math.floor(ex.length / 2)]).toFixed(2)}% of the pot, at most ${(100 * ex[ex.length - 1]).toFixed(2)}%. Largest difference between the solver's values and the independent recomputation: ${Math.max(...results.map((r) => r.checkDiff)).toExponential(1)} chips.`, '');
  for (const facing of [false, true]) {
    const rs = results.filter((r) => r.facing === facing);
    if (!rs.length) continue;
    const classes = facing ? ['fold', 'call', 'raise'] : ['check', 'bet small', 'bet medium', 'bet large or more'];
    const m = new Map<string, Acc>();
    for (const r of rs) {
      for (const c of classes) add(m, `sol|${c}`, r.solution[c] ?? 0);
      for (const n of names) {
        const a = r.advice[n];
        if (!a) continue;
        add(m, `${n}|loss`, a.lossBB);
        add(m, `${n}|agree`, a.probInSolution >= 0.05 ? 1 : 0);
        for (const c of classes) add(m, `${n}|${c}`, a.cls === c ? 1 : 0);
        if (r.advice.v1 && n !== 'v1') add(m, `${n}|vs v1`, a.lossBB - r.advice.v1.lossBB);
      }
    }
    out.push(`### River, ${facing ? 'facing a bet' : 'no bet to face'} (${rs.length} spots)`, '',
      `| | ${classes.join(' | ')} | Loss against the solution (bb) | Loss minus version 1's (bb) | Action has at least 5% in the solution |`, `|---|${classes.map(() => '---').join('|')}|---|---|---|`,
      `| Solution, for Hero's hand | ${classes.map((c) => ci(m.get(`sol|${c}`), 0, true)).join(' | ')} | 0 by definition | | |`);
    for (const n of names) out.push(`| ${n} | ${classes.map((c) => ci(m.get(`${n}|${c}`), 0, true)).join(' | ')} | ${ci(m.get(`${n}|loss`))} (n=${m.get(`${n}|loss`)?.n ?? 0}) | ${n === 'v1' ? '' : ci(m.get(`${n}|vs v1`))} | ${ci(m.get(`${n}|agree`), 0, true)} |`);
    out.push('');
  }
  return out;
}

async function main(): Promise<void> {
  const tables = argS('tables', 'hu-re,hu-trapper,hu-tag').split(',');
  const hands = argN('hands', 1500), seed = argN('seed', 9100), cap = argN('cap', 140), maxSpots = argN('max-spots', 150), tol = Number(argS('tolerance', '0.01'));
  const lines: string[] = ['## River decisions against the solver reference', '',
    `Heads-up tables ${tables.join(', ')}; ${hands} hands each, seed ${seed}; engines at 400 samples; ranges capped at the ${cap} heaviest hands per player.`,
    'Ranges are the version 2 engine\'s own beliefs at each spot. The reference is an approximate equilibrium of the one-street river game with those ranges and the engine\'s bet sizes; it is not a solution of the whole hand.', ''];
  const all: SpotResult[] = [];
  let dropped = 0;
  for (const t of tables) {
    const spots = (await collectSpots(t, hands, seed, 400, {})).slice(0, maxSpots);
    for (const s of spots) {
      const r = evaluateSpot(s, cap);
      if (!r || r.exploitPotShare > tol) { dropped++; continue; }
      all.push(r);
    }
    console.error(`${t}: ${spots.length} spots, ${all.length} usable so far`);
  }
  lines.push(...riverReport(all, dropped, tol, ['v1', 'v2']));
  console.log(lines.join('\n'));
  const out = argS('out', '');
  if (out) fs.writeFileSync(out, lines.join('\n') + '\n');
  const json = argS('json', '');
  if (json) fs.writeFileSync(json, JSON.stringify(all));
}

if (process.argv[1] && /river-compare\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
