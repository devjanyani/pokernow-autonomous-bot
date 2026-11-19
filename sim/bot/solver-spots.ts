// ============================================================
// Phase 2.3, stage 8: river decisions of v1, v2, v3 (and the PokerBench model) against the in-repository solver,
// with INDEPENDENTLY SPECIFIED ranges.
//
//   npx tsx sim/bot/solver-spots.ts [--hands-per 16] [--cap 150] [--samples 800] [--out report.md]
//
// Ranges do not come from any engine's behaviour model:
//   - each player's range is a top-X% preflop range (the repository's equity ordering), with the board removed;
//   - when Hero faces a bet at the root, the bettor's range is written down explicitly: POLAR (the strongest 15%
//     of its range by made-hand strength on the river, plus the weakest 12% as bluffs) or CONDENSED (the middle);
//   - both ranges are thinned deterministically to at most `cap` hands each, spread evenly by made-hand strength,
//     so that the solver runs in seconds. The same thinned ranges are given to every engine.
//
// Two kinds of spot:
//   ROOT   Hero's first river decision (out of position first to act, in position checked to, or facing a lead).
//   CHECK-RAISE  Hero out of position checks, the other player bets three quarters of the pot, Hero decides.
//          The river game is solved from Hero's first action; at the node after the bet each player's range is
//          what the equilibrium puts there (the bettor's betting range, Hero's checking range), and THOSE ranges are
//          given to the engines. So every adviser decides with the same information as the equilibrium player.
//
// Measured per Hero hand: the value of each of Hero's actions at the decision, playing on as well as possible
// against the solution's strategy for the other player ("best response"), and the loss of each adviser's action
// against the best action. Rake: none. The solver's abstraction: bets of 33%, 75% (and 125% at the root) of the pot,
// one raise of 75%, all-in. Engine sizes are matched to the nearest abstraction size, which is itself an
// approximation. The solution is an approximate equilibrium of the one-street game with these ranges; it is not
// a solution of the whole hand and not "GTO". Exploitability of every solution is reported.
// ============================================================

import * as fs from 'fs';
import { CardId, COMBO_HI, COMBO_LO, comboIndex, NUM_COMBOS, parseCardStrict } from '../../src/bot/cards';
import { computeFeatures, NEUTRAL } from '../../src/bot/ranges/postflop-model';
import { Range, removeDead, topRange } from '../../src/bot/ranges/range';
import { PostflopSolver } from '../../src/bot/strategy/postflop';
import { PostflopSolverV1 } from '../../src/bot/strategy/postflop-v1';
import { defaultKnobs } from '../../src/bot/strategy/v3/model';
import { PostflopSearchV3 } from '../../src/bot/strategy/v3/search';
import type { VillainModel } from '../../src/bot/strategy/villains';
import { HandState, legalActions, potTotal, seatOf } from '../../src/bot/table/engine';
import type { RangeHand } from '../../src/core/solver/postflop-cfr';
import { mlAdvice } from './ml-adapter';
import { independentCheck, nodeAnalysis, RiverSpec, solveRiver, villainActionProbs } from './river-reference';
import { buildSpot } from './scenarios';

const argN = (f: string, d: number) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };

interface Template {
  name: string;
  kind: 'root' | 'check-raise';
  /** Hero's seat: BB acts first after the flop, BTN last. */
  hero: 'BB' | 'BTN';
  board: string;
  heroTop: number;
  villainTop: number;
  /** River actions before Hero's decision ("" = Hero first). For check-raise spots: set by the harness. */
  river: string;
  /** Root, facing a lead: the bettor's range shape. */
  bettor?: 'polar' | 'condensed';
  /** What the spot tests. */
  tests: string;
}

const TEMPLATES: Template[] = [
  { name: 'oop-first-dry', kind: 'root', hero: 'BB', board: 'Kh 9d 5s 2c 7h', heroTop: 0.45, villainTop: 0.3, river: '', tests: 'bet versus check, out of position, first to act' },
  { name: 'ip-checked-to-dry', kind: 'root', hero: 'BTN', board: 'Kh 9d 5s 2c 7h', heroTop: 0.3, villainTop: 0.45, river: 'BB x', tests: 'value betting and size choice in position' },
  { name: 'ip-checked-to-wet', kind: 'root', hero: 'BTN', board: 'Jh Th 6s 9c 2h', heroTop: 0.3, villainTop: 0.45, river: 'BB x', tests: 'value betting and bluffing on a coordinated board' },
  { name: 'ip-facing-polar-lead', kind: 'root', hero: 'BTN', board: 'Qs 8d 4c 3h Ks', heroTop: 0.3, villainTop: 0.45, river: 'BB b14', bettor: 'polar', tests: 'bluff-catching and value raising against a polar bet' },
  { name: 'ip-facing-condensed-lead', kind: 'root', hero: 'BTN', board: 'Qs 8d 4c 3h Ks', heroTop: 0.3, villainTop: 0.45, river: 'BB b14', bettor: 'condensed', tests: 'raising for value and bluff-raising against a condensed bet' },
  { name: 'oop-check-raise-dry', kind: 'check-raise', hero: 'BB', board: 'Kh 9d 5s 2c 7h', heroTop: 0.45, villainTop: 0.3, river: '', tests: 'check-raise, check-call, check-fold after checking first' },
  { name: 'oop-check-raise-wet', kind: 'check-raise', hero: 'BB', board: 'Jh Th 6s 9c 2h', heroTop: 0.45, villainTop: 0.3, river: '', tests: 'check-raise on a coordinated board' },
];

const PRE = 'UTG f, HJ f, CO f, BTN r2.5, SB f, BB c';
const cards = (s: string) => s.split(' ');

/** Thin a range to at most `cap` hands, evenly spread by made-hand strength on the board; weights kept. */
function thin(r: Range, board: number[], cap: number, keep: number[] = []): Range {
  const f = computeFeatures(board);
  const idx: number[] = [];
  for (let k = 0; k < NUM_COMBOS; k++) if (r[k] > 0 && f.hs[k] >= 0) idx.push(k);
  idx.sort((a, b) => f.hs[a] - f.hs[b] || a - b);
  const out = new Float64Array(NUM_COMBOS);
  const n = Math.min(cap, idx.length);
  for (let i = 0; i < n; i++) { const k = idx[Math.floor((i + 0.5) * idx.length / n)]; out[k] = r[k]; }
  for (const k of keep) if (r[k] > 0) out[k] = r[k];
  return out;
}
/** The bettor's range: polar = top 15% + bottom 12% by made-hand strength; condensed = from 30% to 75%. */
function shape(r: Range, board: number[], kind: 'polar' | 'condensed'): Range {
  const f = computeFeatures(board);
  const idx: number[] = [];
  for (let k = 0; k < NUM_COMBOS; k++) if (r[k] > 0 && f.hs[k] >= 0) idx.push(k);
  idx.sort((a, b) => f.hs[a] - f.hs[b]);
  const out = new Float64Array(NUM_COMBOS);
  idx.forEach((k, i) => { const q = i / idx.length; if (kind === 'polar' ? q >= 0.85 || q < 0.12 : q >= 0.3 && q < 0.75) out[k] = r[k]; });
  return out;
}
const toHands = (r: Range): RangeHand[] => { const out: RangeHand[] = []; for (let k = 0; k < NUM_COMBOS; k++) if (r[k] > 0) out.push({ cards: [COMBO_LO[k] as CardId, COMBO_HI[k] as CardId], weight: r[k] }); return out; };
function fromSolverReach(hands: [number, number][], w: Float64Array): Range {
  const out = new Float64Array(NUM_COMBOS);
  hands.forEach((c, i) => { out[comboIndex(c[0], c[1])] += w[i]; });
  return out;
}

function villainModel(h: HandState, seat: number, range: Range): VillainModel {
  const s = seatOf(h, seat);
  return { seat, playerId: s.playerId, name: s.name, range, line: 'specified', tend: NEUTRAL, stack: s.stack, streetCommit: s.streetCommit, totalCommit: s.totalCommit, allIn: s.allIn, actsBehind: true, summary: '', rangeBasis: 'heuristic', rangeSource: 'specified', retained: 1, poorFit: false };
}

interface Advice { kind: string; chips: number; /** v3: the model's fold probability for the whole range after Hero's action (raises only). */ predFold?: number }
type Eng = 'v1' | 'v2' | 'v3' | 'v3p' | 'ml';
// Phase 2.5: v3p = version 3 with the population calibration fitted to real hands (sim/bot/phase25/calibrate.ts).
const POP = () => JSON.parse(fs.readFileSync('src/bot/strategy/v3/population-calibration.json', 'utf8'));
function advise(engine: Eng, h: HandState, heroSeat: number, hole: [number, number], villain: VillainModel, heroPerceived: Range, samples: number, seed: number): Advice | null {
  const la = legalActions(h, heroSeat)!;
  const hero = seatOf(h, heroSeat);
  const f = computeFeatures(h.board);
  let pick: { action: string; to?: number } | null = null;
  if (engine === 'ml') { const a = mlAdvice(h, heroSeat, hole, la); pick = a ? { action: a.action, to: a.to } : null; }
  else if (engine === 'v3' || engine === 'v3p') {
    const k = defaultKnobs(NEUTRAL);
    if (engine === 'v3p') k.population = POP();
    const s = new PostflopSearchV3(h, heroSeat, hole, villain, k, f, seed, heroPerceived);
    s.run(samples);
    const r = s.result(2.5, false);
    const c = r.candidates[r.best];
    let predFold: number | undefined;
    if (c.action === 'raise' || c.action === 'bet') {
      const any = villain.range.findIndex((w) => w > 0);
      const resp = any >= 0 ? s.responseAt(r.best, any) : null;
      if (resp) predFold = resp.forRange[0];
    }
    return { kind: c.action, chips: c.action === 'bet' || c.action === 'raise' ? (c.to as number) - hero.streetCommit : 0, predFold };
  } else if (engine === 'v2') {
    const s = new PostflopSolver(h, heroSeat, hole, [villain], f, seed, heroPerceived);
    s.run(samples);
    const r = s.result();
    pick = r.candidates[r.best];
  } else {
    const s = new PostflopSolverV1(h, heroSeat, hole, [villain], f, seed);
    s.run(samples);
    const r = s.result();
    pick = r.candidates[r.best];
  }
  if (!pick) return null;
  return { kind: pick.action, chips: pick.action === 'bet' || pick.action === 'raise' ? (pick.to as number) - hero.streetCommit : 0 };
}

/** Index of the solver action an adviser's action corresponds to (sizes: nearest in chips). */
function matchAction(kinds: string[], chips: number[], a: Advice): number {
  if (a.kind === 'fold' || a.kind === 'check' || a.kind === 'call') return kinds.indexOf(a.kind);
  let best = -1;
  for (let i = 0; i < kinds.length; i++) if ((kinds[i] === 'bet' || kinds[i] === 'raise' || kinds[i] === 'allin') && (best < 0 || Math.abs(chips[i] - a.chips) < Math.abs(chips[best] - a.chips))) best = i;
  return best;
}
const klass = (kind: string, chips: number, pot: number) => (kind === 'fold' || kind === 'check' || kind === 'call' ? kind : kind === 'allin' ? 'all-in' : chips / pot < 0.5 ? `${kind} small` : chips / pot < 1 ? `${kind} medium` : `${kind} large`);

interface Acc { n: number; s: number; ss: number }
const add = (m: Map<string, Acc>, k: string, x: number) => { const a = m.get(k) ?? { n: 0, s: 0, ss: 0 }; a.n++; a.s += x; a.ss += x * x; m.set(k, a); };
const ci = (a: Acc | undefined, d = 2, pct = false) => { if (!a || !a.n) return '–'; const m = a.s / a.n, h = a.n > 1 ? 1.96 * Math.sqrt(Math.max(0, a.ss / a.n - m * m) / (a.n - 1)) : 0; return pct ? `${(100 * m).toFixed(0)}% ± ${(100 * h).toFixed(0)}` : `${m.toFixed(d)} ± ${h.toFixed(d)}`; };

async function main(): Promise<void> {
  const per = argN('hands-per', 16), cap = argN('cap', 150), samples = argN('samples', 800);
  const engines = argS('engines', 'v1,v2,v3,ml').split(',') as Eng[];
  const diag: string[] = ['## Version 3 raises against a lead: predicted fold against the equilibrium fold', '', '| Spot | Engine | Hero hand percentile | Action | Predicted fold of the range | Equilibrium fold at that node | Loss (bb) |', '|---|---|---|---|---|---|---|'];
  const L: string[] = ['## River decisions against the solver, independently specified ranges', '',
    `Engines at ${samples} samples, version 3 with its model-uncertainty mixture switched on (its default). Ranges thinned to at most ${cap} hands per player. ${per} Hero hands per spot, spread over Hero's range by made-hand strength. Loss = value of the best action minus value of the adviser's action, both playing on as well as possible against the solution's other player; big blinds per decision.`, ''];
  const total = new Map<string, Acc>();
  for (const t of TEMPLATES) {
    const board = cards(t.board).map((c) => parseCardStrict(c) as number);
    const pot0 = 390;
    // Ranges.
    let hr = thin(removeDead(topRange(t.heroTop), board), board, cap);
    let vr = removeDead(topRange(t.villainTop), board);
    if (t.bettor) vr = shape(vr, board, t.bettor);
    vr = thin(vr, board, cap);
    // Spot: preflop BTN raise, BB call; flop BB x BTN b2 BB c; turn BB x BTN b5 BB c; river as specified.
    const river = t.kind === 'check-raise' ? '' : t.river;
    const lines = [PRE, `${cards(t.board).slice(0, 3).join(' ')}: BB x, BTN b2, BB c`, `${cards(t.board)[3]}: BB x, BTN b5, BB c`, `${cards(t.board)[4]}: ${river}`];
    const toCall = t.river.includes(' b') && t.kind === 'root' ? 280 : 0;
    const spec: RiverSpec = { board, hero: toHands(hr), villain: toHands(vr), pot: pot0, stack: 1810, toCall, heroIsIP: t.hero === 'BTN', betFractions: toCall > 0 ? [0.75] : t.kind === 'check-raise' ? [0.33, 0.75] : [0.33, 0.75, 1.25], raiseFractions: [0.75], maxAggressions: 3 };
    const sol = solveRiver(spec, { maxIterations: 3000, targetPotShare: 0.002 });
    const chk = independentCheck(sol, spec);
    let analysis: { kinds: string[]; chips: number[]; values: Float64Array[]; probs: Float64Array[] };
    let path: string[] = [];
    let betChips = 0;
    if (t.kind === 'check-raise') {
      const root = sol.solver.root;
      const x = root.actions.findIndex((a) => a.kind === 'check');
      const after = root.children[x];
      const b75 = after.actions.findIndex((a) => a.kind === 'bet' && Math.abs(a.potFraction - 0.75) < 0.05);
      path = [root.actions[x].label, after.actions[b75].label];
      betChips = after.actions[b75].chips;
      const na = nodeAnalysis(sol, spec, path);
      analysis = na;
      // The ranges at the node, as the equilibrium has them.
      hr = fromSolverReach(sol.solver.hands[0] as [number, number][], na.heroReach);
      vr = fromSolverReach(sol.solver.hands[1] as [number, number][], na.villainReach);
    } else {
      const root = sol.solver.root;
      analysis = { kinds: root.actions.map((a) => a.kind), chips: root.actions.map((a) => a.chips), values: chk.actionValues, probs: chk.actionProbs };
    }
    const heroHands = sol.solver.hands[0] as [number, number][];
    // Hero hands to test: spread over the hands that reach the decision, by made-hand strength.
    const f = computeFeatures(board);
    const reachW = t.kind === 'check-raise' ? (() => { const w = new Float64Array(heroHands.length); heroHands.forEach((c, i) => { w[i] = hr[comboIndex(c[0], c[1])]; }); return w; })() : sol.solver.weights[0];
    const cand = heroHands.map((c, i) => ({ i, c, hs: f.hs[comboIndex(c[0], c[1])], w: reachW[i] })).filter((x) => x.w > 1e-6 * Math.max(...Array.from(reachW)) && Number.isFinite(analysis.values[0][x.i])).sort((a, b) => a.hs - b.hs);
    const picks = Array.from({ length: Math.min(per, cand.length) }, (_, k) => cand[Math.floor((k + 0.5) * cand.length / Math.min(per, cand.length))]);
    const m = new Map<string, Acc>();
    const solClass = new Map<string, number>();
    const advClass = new Map<string, Map<string, number>>();
    const riverText = t.kind === 'check-raise' ? `BB x, BTN b${(betChips / 20).toFixed(3).replace(/\.?0+$/, '')}` : t.river;
    for (const p of picks) {
      const hole: [number, number] = [p.c[0], p.c[1]];
      const holeText = `${'23456789TJQKA'[hole[0] >> 2]}${'hdcs'[hole[0] & 3]} ${'23456789TJQKA'[hole[1] >> 2]}${'hdcs'[hole[1] & 3]}`;
      let b;
      try { b = buildSpot({ players: 6, hero: t.hero, cards: holeText, lines: [lines[0], lines[1], lines[2], `${cards(t.board)[4]}: ${riverText}`] }); } catch { continue; }
      const opp = b.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== b.heroSeat)!.seat;
      const vm = villainModel(b.h, opp, removeDead(vr, hole));
      const heroPerc = removeDead(hr, []);
      const vals = analysis.kinds.map((_, a) => analysis.values[a][p.i]);
      const best = Math.max(...vals);
      const potBB = potTotal(b.h) / 20;
      // The solution's mix for this hand, by class.
      analysis.kinds.forEach((k, a) => { const c = klass(k, analysis.chips[a], potTotal(b.h) - (t.kind === 'check-raise' ? betChips : toCall)); solClass.set(c, (solClass.get(c) ?? 0) + analysis.probs[a][p.i]); });
      for (const e of engines) {
        const adv = advise(e, b.h, b.heroSeat, hole, vm, heroPerc, samples, 7 + p.i);
        if (!adv) continue;
        const ai = matchAction(analysis.kinds, analysis.chips, adv);
        if (ai < 0) continue;
        const loss = (best - vals[ai]) / 20;
        if (adv.predFold !== undefined && t.kind === 'root' && toCall > 0 && analysis.kinds[ai] !== 'fold' && analysis.kinds[ai] !== 'call') {
          const label = sol.solver.root.actions[ai].label;
          const eq = villainActionProbs(sol, spec, [label], p.i);
          const fi = eq.kinds.indexOf('fold');
          diag.push(`| ${t.name} | ${e} | ${p.hs.toFixed(2)} | ${analysis.kinds[ai]} ${(analysis.chips[ai] / 20).toFixed(0)} bb | ${(100 * adv.predFold).toFixed(0)}% | ${fi >= 0 ? (100 * eq.probs[fi]).toFixed(0) : '–'}% | ${loss.toFixed(2)} |`);
        }
        add(m, `${e}|loss`, loss); add(total, `${e}|loss`, loss);
        add(m, `${e}|support`, analysis.probs[ai][p.i] >= 0.05 ? 1 : 0); add(total, `${e}|support`, analysis.probs[ai][p.i] >= 0.05 ? 1 : 0);
        const c = klass(analysis.kinds[ai], analysis.chips[ai], potTotal(b.h) - (t.kind === 'check-raise' ? betChips : toCall));
        if (!advClass.has(e)) advClass.set(e, new Map());
        advClass.get(e)!.set(c, (advClass.get(e)!.get(c) ?? 0) + 1);
        void potBB;
      }
    }
    const n = picks.length;
    const classes = [...new Set([...solClass.keys(), ...[...advClass.values()].flatMap((x) => [...x.keys()])])].sort();
    L.push(`### ${t.name}: ${t.tests}`, '',
      `Board ${t.board}; Hero ${t.hero === 'BB' ? 'out of position' : 'in position'}, top ${(100 * t.heroTop).toFixed(0)}% preflop range; other player top ${(100 * t.villainTop).toFixed(0)}%${t.bettor ? `, betting range ${t.bettor}` : ''}. Pot ${pot0 / 20} bb, ${1810 / 20} bb behind.${t.kind === 'check-raise' ? ` Decision after Hero checks and the other player bets ${(betChips / 20).toFixed(1)} bb; ranges at that node from the equilibrium.` : ''}`,
      `Solver: ${sol.iterations} iterations; a best-responder gains ${(100 * sol.exploitPotShare).toFixed(2)}% of the pot (independent recomputation: ${(100 * chk.exploitChips / pot0).toFixed(2)}%; largest value difference ${chk.maxValueDiff.toExponential(1)} chips). ${n} Hero hands.`, '',
      `| | ${classes.join(' | ')} | Loss (bb per decision) | Action in the solution's support |`, `|---|${classes.map(() => '---').join('|')}|---|---|`,
      `| Solution (average over the ${n} hands) | ${classes.map((c) => `${(100 * (solClass.get(c) ?? 0) / n).toFixed(0)}%`).join(' | ')} | 0 | 100% |`,
      ...engines.map((e) => `| ${e} | ${classes.map((c) => `${(100 * (advClass.get(e)?.get(c) ?? 0) / Math.max(1, m.get(`${e}|loss`)?.n ?? 0)).toFixed(0)}%`).join(' | ')} | ${ci(m.get(`${e}|loss`))} (n=${m.get(`${e}|loss`)?.n ?? 0}) | ${ci(m.get(`${e}|support`), 0, true)} |`), '');
    console.error(`${t.name}: done (${n} hands, exploitability ${(100 * sol.exploitPotShare).toFixed(2)}%)`);
  }
  L.push('### All spots together', '', '| Adviser | Loss (bb per decision) | Action in the solution\'s support |', '|---|---|---|', ...engines.map((e) => `| ${e} | ${ci(total.get(`${e}|loss`))} (n=${total.get(`${e}|loss`)?.n ?? 0}) | ${ci(total.get(`${e}|support`), 0, true)} |`), '');
  L.push('', ...diag, '');
  console.log(L.join('\n'));
  const out = argS('out', '');
  if (out) fs.writeFileSync(out, L.join('\n') + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
