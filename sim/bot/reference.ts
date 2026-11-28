// ============================================================
// Reference evaluator for the SIMULATOR: the value of each candidate action of the measured seat under the
// TRUE policies of the other seats.
//
// OFFLINE ONLY. It reads every player's hole cards and calls the opponents' real policies, which the live
// bot can never do. It lives in sim/ (outside src/), is not part of the extension bundle, and a test
// (tests/bot/reference.test.ts) fails if anything under src/ imports it. The measured seat's own
// continuation policy is only ever given its own cards, exactly as in normal simulated play.
//
// What a value means. For a decision point reached in simulated play, with the actual hole cards of
// everyone, the value of action a is the measured seat's expected change in stack from this point on:
// folding now is 0, exactly like `Candidate.ev` in the engine, so the two are directly comparable.
//   - the cards still to come are enumerated on the turn (every possible river) and on the river (none),
//     and sampled on the flop (the same run-outs for every action);
//   - the opponents act by their real policies; their private randomness is sampled, with the same seeds
//     for every action (common random numbers), so differences between actions are far less noisy than
//     the values themselves;
//   - after the action the measured seat continues by `continuation`.
// "Exact" therefore applies to the chance cards on the turn and river. Policy randomness is always sampled,
// because policies are black boxes that return an action, not a distribution. Against deterministic
// opponents on the river the value is exact (zero standard error).
//
// What it is NOT. Conditioning on the actual hidden cards makes a single value clairvoyant: the best action
// for one deal is not something a player could know. Only AVERAGES over many decision points are used
// (sim/bot/reference-eval.ts): the average of [value of the action chosen] is that policy's true result
// from those states, and the average of [value of alternative X minus value of the action chosen] says
// whether choosing X in that class of spots would have earned more.
// ============================================================

import { CardId, Rng } from '../../src/bot/cards';
import { evaluateHand } from '../../src/core/equity/hand-eval';
import type { Policy } from '../../src/bot/sim/table';
import {
  ActionInput, applyAction, awaitingBoard, cloneHand, completeHand, dealBoard, HandState, legalActions, validateAction,
} from '../../src/bot/table/engine';

export type Choice = Omit<ActionInput, 'seat'>;

export interface RefSpot {
  h: HandState;
  heroSeat: number;
  /** Hole cards of every dealt-in seat (hidden information: simulator only). */
  holes: ReadonlyMap<number, [CardId, CardId]>;
  /** The real policy of every seat other than the measured one. */
  policies: ReadonlyMap<number, Policy>;
  /** How the measured seat plays after the candidate action. Sees only its own cards. */
  continuation: Policy;
}

export interface RefOptions {
  seed: number;
  /** Run-outs sampled on the flop. */
  flopRunouts?: number;
  /** Rivers used on the turn: 'all' enumerates every remaining card. */
  turnRivers?: number | 'all';
  /** Repetitions of each run-out with fresh policy randomness. */
  reps?: number;
  /**
   * Phase 3.1c: also value PREFLOP decision points (the five board cards are sampled like a flop run-out). Off by
   * default, so every earlier caller keeps its postflop-only check.
   */
  allowPreflop?: boolean;
  /**
   * Phase 3.1c: post-hoc rake charged to the measured seat's winnings: `pct` of the final pot capped at `cap`
   * chips, only when a flop was dealt (no flop, no drop). Omitted = no rake, as before.
   */
  rake?: { pct: number; cap: number };
}

export interface RefValue {
  action: Choice;
  /** Mean change in the measured seat's stack from the decision point, in chips (fold now = 0). */
  mean: number;
  /** Standard error of the mean over the scenarios. Zero when everything is deterministic. */
  se: number;
  /** One value per scenario, in the same scenario order for every action. */
  samples: number[];
  /** True when the chance cards were enumerated (turn, river) rather than sampled. */
  chanceExact: boolean;
}

interface Scenario { future: CardId[]; seed: number }

function scenarios(spot: RefSpot, o: RefOptions): { list: Scenario[]; exact: boolean } {
  const { h } = spot;
  const used = new Set<CardId>(h.board);
  for (const c of spot.holes.values()) { used.add(c[0]); used.add(c[1]); }
  const rest: CardId[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c as CardId)) rest.push(c as CardId);
  const rng = new Rng(o.seed);
  const reps = Math.max(1, o.reps ?? 1);
  const need = 5 - h.board.length;
  const out: Scenario[] = [];
  const push = (future: CardId[]) => { for (let r = 0; r < reps; r++) out.push({ future, seed: rng.int(1 << 30) }); };
  if (need <= 0) { push([]); return { list: out, exact: true }; }
  if (need === 1) {
    const k = o.turnRivers ?? 'all';
    if (k === 'all' || k >= rest.length) { for (const c of rest) push([c]); return { list: out, exact: true }; }
    const pool = rest.slice();
    for (let i = 0; i < k; i++) { const j = i + rng.int(pool.length - i); [pool[i], pool[j]] = [pool[j], pool[i]]; push([pool[i]]); }
    return { list: out, exact: false };
  }
  const n = o.flopRunouts ?? 24;
  for (let i = 0; i < n; i++) {
    const pool = rest.slice();
    const future: CardId[] = [];
    for (let d = 0; d < need; d++) { const j = d + rng.int(pool.length - d); [pool[d], pool[j]] = [pool[j], pool[d]]; future.push(pool[d]); }
    push(future);
  }
  return { list: out, exact: false };
}

/** Play one scenario to the end after the measured seat takes `first`. Returns its change in stack from the decision point. */
async function rollout(spot: RefSpot, first: Choice, sc: Scenario, rake?: { pct: number; cap: number }): Promise<number> {
  const h = cloneHand(spot.h);
  const hero = h.seats.find((s) => s.seat === spot.heroSeat)!;
  const before = hero.stack;
  const base = new Rng(sc.seed);
  let dealt = 0;
  applyAction(h, { seat: spot.heroSeat, ...first });
  for (let guard = 0; h.phase !== 'complete' && h.phase !== 'showdown'; guard++) {
    if (guard > 400) throw new Error('reference rollout did not terminate');
    if (h.toAct !== null) {
      const seat = h.toAct;
      const la = legalActions(h)!;
      const policy = seat === spot.heroSeat ? spot.continuation : spot.policies.get(seat);
      if (!policy) throw new Error(`no policy for seat ${seat}`);
      let input: ActionInput;
      try { input = { seat, ...(await policy.act({ h, seat, hole: spot.holes.get(seat)!, la, rng: base.fork(seat * 1000 + h.events.length) })) }; }
      catch { input = { seat, kind: la.canCheck ? 'check' : 'fold' }; }
      if (validateAction(h, input)) input = { seat, kind: la.canCheck ? 'check' : 'fold' };
      applyAction(h, input);
    } else if (awaitingBoard(h)) {
      const n = h.street === 'preflop' ? 3 : 1;
      dealBoard(h, sc.future.slice(dealt, dealt + n));
      dealt += n;
    } else throw new Error(`reference rollout stuck in phase ${h.phase}`);
  }
  if (h.phase === 'showdown') completeHand(h, (seat) => evaluateHand([...spot.holes.get(seat)!, ...h.board]));
  const net = hero.stack - before;
  return rake ? net - rakeShare(h, spot.heroSeat, rake) : net;
}

/** The measured seat's share of a post-hoc rake: in proportion to its winnings over the whole hand (none on a loss). */
function rakeShare(h: HandState, heroSeat: number, rake: { pct: number; cap: number }): number {
  if (h.board.length < 3) return 0;
  let pot = 0, won = 0, heroWon = 0;
  for (const s of h.seats) {
    if (!s.dealtIn) continue;
    pot += s.totalCommit;
    const n = s.stack - s.startStack;
    if (n > 0) { won += n; if (s.seat === heroSeat) heroWon = n; }
  }
  return won > 0 ? Math.min(rake.cap, rake.pct * pot) * heroWon / won : 0;
}

/** Value of each candidate action at one postflop decision point of the measured seat. */
export async function referenceValues(spot: RefSpot, candidates: readonly Choice[], o: RefOptions): Promise<RefValue[]> {
  const { h } = spot;
  if (h.toAct !== spot.heroSeat) throw new Error('referenceValues: it is not the measured seat\'s turn');
  if (h.board.length < 3 && !o.allowPreflop) throw new Error('referenceValues: postflop decision points only');
  const { list, exact } = scenarios(spot, o);
  const out: RefValue[] = [];
  for (const action of candidates) {
    const err = validateAction(h, { seat: spot.heroSeat, ...action });
    if (err) throw new Error(`referenceValues: illegal candidate ${action.kind}${action.to !== undefined ? ` ${action.to}` : ''}: ${err.code}`);
    const samples: number[] = [];
    if (action.kind === 'fold') for (let i = 0; i < list.length; i++) samples.push(0);
    else for (const sc of list) samples.push(await rollout(spot, action, sc, o.rake));
    const n = samples.length;
    const mean = samples.reduce((a, b) => a + b, 0) / n;
    const v = n > 1 ? samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1) : 0;
    out.push({ action, mean, se: Math.sqrt(v / n), samples, chanceExact: exact });
  }
  return out;
}

/** Mean and standard error of the paired difference a - b over the shared scenarios. */
export function pairedDiff(a: RefValue, b: RefValue): { mean: number; se: number } {
  const n = Math.min(a.samples.length, b.samples.length);
  let s = 0, ss = 0;
  for (let i = 0; i < n; i++) { const d = a.samples[i] - b.samples[i]; s += d; ss += d * d; }
  const mean = s / n;
  return { mean, se: n > 1 ? Math.sqrt(Math.max(0, ss / n - mean * mean) / (n - 1)) : 0 };
}
