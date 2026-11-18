// ============================================================
// River reference from the in-repository solver (src/core/solver/postflop-cfr.ts).
//
// What is solved. A heads-up river decision is a small two-player zero-sum game once four things are fixed:
// the board, each player's RANGE (weighted hands), the pot and stacks, and the bet sizes allowed. For such a
// game the solver's range-versus-range DCFR finds an approximate Nash equilibrium, and the distance from an
// exact one is measurable (exploitability: what a best-responding opponent gains). No card is still to come,
// so nothing is approximated at the leaves.
//
// What that is, and is not.
//   - It is the equilibrium of THIS ONE-STREET GAME with THESE RANGES and THESE BET SIZES. It is not "GTO"
//     for the hand: equilibrium ranges on the river depend on equilibrium play on every earlier street,
//     which nobody here has.
//   - Each solve reports its exploitability; results are used only below a stated threshold, and are called
//     approximate equilibria, never exact.
//   - The solver's own numbers are not trusted blindly: `independentCheck` recomputes every value by plain
//     pairwise enumeration with separate code, and tests/bot/river-reference.test.ts checks a game whose
//     equilibrium is known in closed form.
//
// Use (sim/bot/river-compare.ts): the ranges are the ones the version 2 engine itself assigns at the spot,
// so the comparison isolates ACTION CHOICE given a belief about ranges from the question of whether those
// ranges are right. Offline only.
// ============================================================

import { evaluateHand } from '../../src/core/equity/hand-eval';
import { BetAbstraction, GameNode, RangeHand, RangeVsRangeCfr, SubgamePlayer } from '../../src/core/solver/postflop-cfr';

export interface RiverSpec {
  board: number[];
  hero: RangeHand[];
  villain: RangeHand[];
  /** Pot before any bet Hero faces. */
  pot: number;
  /** Most chips either player can still put in. */
  stack: number;
  /** Bet Hero faces (0 when none). */
  toCall: number;
  /** Hero acts last: with toCall = 0 the other player has already checked. */
  heroIsIP: boolean;
  /** Bet sizes allowed, as fractions of the pot. */
  betFractions: number[];
  raiseFractions?: number[];
  maxAggressions?: number;
}

export interface RiverSolution {
  solver: RangeVsRangeCfr;
  iterations: number;
  /** What a best-responding opponent gains on average, in chips and as a share of the pot. */
  exploitChips: number;
  exploitPotShare: number;
}

export function solveRiver(spec: RiverSpec, o: { maxIterations?: number; targetPotShare?: number; checkEvery?: number } = {}): RiverSolution {
  if (spec.board.length !== 5) throw new Error('solveRiver: a five-card board is required');
  const abstraction: BetAbstraction = {
    betFractions: spec.betFractions, raiseFractions: spec.raiseFractions ?? [0.75], maxAggressions: spec.maxAggressions ?? 3,
    allInMaxSpr: 1e9, allInThreshold: 0.9,
  };
  const solver = new RangeVsRangeCfr({
    board: spec.board, hero: spec.hero, villain: spec.villain,
    tree: { startingPot: spec.pot, effectiveStack: spec.stack, toCall: spec.toCall, heroIsIP: spec.heroIsIP, priorAggressions: spec.toCall > 0 ? 1 : 0, abstraction },
  });
  const max = o.maxIterations ?? 1500, target = (o.targetPotShare ?? 0.003) * spec.pot, every = o.checkEvery ?? 100;
  let exploit = Infinity;
  while (solver.iterations < max) {
    for (let i = 0; i < every && solver.iterations < max; i++) solver.iterate();
    exploit = solver.exploitability();
    if (exploit <= target) break;
  }
  return { solver, iterations: solver.iterations, exploitChips: exploit, exploitPotShare: exploit / spec.pot };
}

// ---- independent recomputation -------------------------------------------------------------
// Plain enumeration over every (own hand, opponent hand) pair, with its own showdown comparison and its own
// card-conflict test. Slower than the solver's vectorised pass and shares no arithmetic with it.

interface Tables { compat: Uint8Array[]; win: Float32Array[]; n: [number, number] }
function tables(spec: RiverSpec, hands: [[number, number][], [number, number][]]): Tables {
  const rank = (c: [number, number]) => evaluateHand([c[0], c[1], ...spec.board]);
  const r = [hands[0].map(rank), hands[1].map(rank)];
  const n: [number, number] = [hands[0].length, hands[1].length];
  const compat = [new Uint8Array(n[0] * n[1]), new Uint8Array(n[1] * n[0])];
  const win = [new Float32Array(n[0] * n[1]), new Float32Array(n[1] * n[0])];
  for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) {
    const a = hands[0][i], b = hands[1][j];
    const ok = a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1] ? 1 : 0;
    compat[0][i * n[1] + j] = ok; compat[1][j * n[0] + i] = ok;
    const s = r[0][i] > r[1][j] ? 1 : r[0][i] === r[1][j] ? 0.5 : 0;
    win[0][i * n[1] + j] = s; win[1][j * n[0] + i] = 1 - s;
  }
  return { compat, win, n };
}

function walk(solver: RangeVsRangeCfr, t: Tables, node: GameNode, p: SubgamePlayer, reachOpp: Float64Array, mode: 'br' | 'avg'): Float64Array {
  const n = t.n[p], no = t.n[p === 0 ? 1 : 0];
  const out = new Float64Array(n);
  if (node.kind !== 'decision') {
    const c = node.committed[p];
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let j = 0; j < no; j++) {
        if (!t.compat[p][i * no + j] || reachOpp[j] === 0) continue;
        const pay = node.kind === 'fold' ? (node.player === p ? -c : node.pot - c) : t.win[p][i * no + j] * node.pot - c;
        v += reachOpp[j] * pay;
      }
      out[i] = v;
    }
    return out;
  }
  const A = node.actions.length;
  const avg = solver.averageStrategy(node);
  if (node.player === p) {
    if (mode === 'br') out.fill(-Infinity);
    for (let a = 0; a < A; a++) {
      const cv = walk(solver, t, node.children[a], p, reachOpp, mode);
      for (let i = 0; i < n; i++) { if (mode === 'br') { if (cv[i] > out[i]) out[i] = cv[i]; } else out[i] += avg[a * n + i] * cv[i]; }
    }
    return out;
  }
  for (let a = 0; a < A; a++) {
    const r = new Float64Array(no);
    for (let j = 0; j < no; j++) r[j] = avg[a * no + j] * reachOpp[j];
    const cv = walk(solver, t, node.children[a], p, r, mode);
    for (let i = 0; i < n; i++) out[i] += cv[i];
  }
  return out;
}

export interface RiverCheck {
  /** Exploitability recomputed independently, in chips. */
  exploitChips: number;
  /** Largest absolute difference between the solver's per-hand values and the recomputed ones, in chips. */
  maxValueDiff: number;
  /** Hero's value per hand when both follow the solution. */
  heroValues: Float64Array;
  /**
   * For each root action and each Hero hand: the value of taking that action now and then playing as well as
   * possible against the solution's strategy for the other player. Chips, net from the start of the subgame.
   */
  actionValues: Float64Array[];
  /** The solution's probability of each root action for each Hero hand. */
  actionProbs: Float64Array[];
}

export function independentCheck(sol: RiverSolution, spec: RiverSpec): RiverCheck {
  const { solver } = sol;
  const t = tables(spec, solver.hands as [[number, number][], [number, number][]]);
  const w = solver.weights;
  const mass = (p: SubgamePlayer) => {
    const n = t.n[p], no = t.n[p === 0 ? 1 : 0], o = p === 0 ? 1 : 0;
    const m = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < no; j++) if (t.compat[p][i * no + j]) s += w[o][j]; m[i] = s; }
    return m;
  };
  const m0 = mass(0);
  let joint = 0;
  for (let i = 0; i < t.n[0]; i++) joint += w[0][i] * m0[i];
  const rangeValue = (p: SubgamePlayer, mode: 'br' | 'avg') => {
    const v = walk(solver, t, solver.root, p, w[p === 0 ? 1 : 0], mode);
    let s = 0;
    for (let i = 0; i < v.length; i++) s += w[p][i] * v[i];
    return s / joint;
  };
  const exploitChips = Math.max(0, (rangeValue(0, 'br') + rangeValue(1, 'br') - spec.pot) / 2);
  const avg0 = walk(solver, t, solver.root, 0, w[1], 'avg');
  const heroValues = new Float64Array(t.n[0]);
  for (let i = 0; i < t.n[0]; i++) heroValues[i] = m0[i] > 0 ? avg0[i] / m0[i] : NaN;
  const theirs = solver.comboValues(0);
  let maxValueDiff = 0;
  for (let i = 0; i < t.n[0]; i++) if (Number.isFinite(heroValues[i]) && Number.isFinite(theirs[i])) maxValueDiff = Math.max(maxValueDiff, Math.abs(heroValues[i] - theirs[i]));
  const root = solver.root;
  const strat = solver.averageStrategy(root);
  const actionValues: Float64Array[] = [], actionProbs: Float64Array[] = [];
  for (let a = 0; a < root.actions.length; a++) {
    const cv = walk(solver, t, root.children[a], 0, w[1], 'br');
    const v = new Float64Array(t.n[0]), pr = new Float64Array(t.n[0]);
    for (let i = 0; i < t.n[0]; i++) { v[i] = m0[i] > 0 ? cv[i] / m0[i] : NaN; pr[i] = strat[a * t.n[0] + i]; }
    actionValues.push(v); actionProbs.push(pr);
  }
  return { exploitChips, maxValueDiff, heroValues, actionValues, actionProbs };
}

export interface NodeAnalysis {
  /** Hero's actions at the node. */
  labels: string[];
  kinds: string[];
  chips: number[];
  /** Per action, per Hero hand: value of taking the action and then best-responding to the solution's villain, conditional on reaching the node. */
  values: Float64Array[];
  /** Per action, per Hero hand: the solution's probability. */
  probs: Float64Array[];
  /** Weights of the villain's hands at the node (its range there under the solution), and of Hero's hands (Hero's range there). */
  villainReach: Float64Array;
  heroReach: Float64Array;
}

/**
 * The same quantities as independentCheck's root analysis, at an inner Hero node reached by the action labels in
 * `path` (e.g. ['X', 'B75'] = Hero checked, villain bet 75%). The villain's range at the node is its starting range
 * times the solution's probability of every villain action on the path; Hero's values are conditional on that range.
 */
export function nodeAnalysis(sol: RiverSolution, spec: RiverSpec, path: string[]): NodeAnalysis {
  const { solver } = sol;
  const t = tables(spec, solver.hands as [[number, number][], [number, number][]]);
  const nv = t.n[1], nh = t.n[0];
  const rv = Float64Array.from(solver.weights[1]), rh = Float64Array.from(solver.weights[0]);
  let node = solver.root;
  for (const label of path) {
    const a = node.actions.findIndex((x) => x.label === label);
    if (a < 0) throw new Error(`no action ${label} at ${node.line} (have ${node.actions.map((x) => x.label).join(',')})`);
    const avg = solver.averageStrategy(node);
    if (node.player === 1) for (let j = 0; j < nv; j++) rv[j] *= avg[a * nv + j];
    else for (let i = 0; i < nh; i++) rh[i] *= avg[a * nh + i];
    node = node.children[a];
  }
  if (node.kind !== 'decision' || node.player !== 0) throw new Error('the path does not end at a Hero decision');
  const mass = new Float64Array(nh);
  for (let i = 0; i < nh; i++) { let s = 0; for (let j = 0; j < nv; j++) if (t.compat[0][i * nv + j]) s += rv[j]; mass[i] = s; }
  const avg = solver.averageStrategy(node);
  const values: Float64Array[] = [], probs: Float64Array[] = [];
  node.actions.forEach((_, a) => {
    const cv = walk(solver, t, node.children[a], 0, rv, 'br');
    values.push(Float64Array.from(cv, (v, i) => (mass[i] > 0 ? v / mass[i] : NaN)));
    probs.push(Float64Array.from({ length: nh }, (_, i) => avg[a * nh + i]));
  });
  return { labels: node.actions.map((x) => x.label), kinds: node.actions.map((x) => x.kind), chips: node.actions.map((x) => x.chips), values, probs, villainReach: rv, heroReach: rh };
}
