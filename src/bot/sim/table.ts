// ============================================================
// Offline Hold'em simulator for 2-10 players, built on the same rules engine
// the bot uses live (table/engine.ts). No DOM, no network, no Node APIs.
//
// Policies see only public information plus their own hole cards.
// ============================================================

import { CardId, Rng, shuffledDeck } from '../cards';
import { evaluateHand } from '../../core/equity/hand-eval';
import {
  ActionInput, applyAction, awaitingBoard, completeHand, createHand, dealBoard, HandState, LegalActions,
  legalActions, totalChips, validateAction,
} from '../table/engine';

export interface PolicyView {
  h: HandState;
  seat: number;
  hole: [CardId, CardId];
  la: LegalActions;
  /** Private randomness for this decision (deterministic per hand/seat/decision). */
  rng: Rng;
}

export interface Policy {
  readonly name: string;
  act(view: PolicyView): Omit<ActionInput, 'seat'> | Promise<Omit<ActionInput, 'seat'>>;
  /** Called once per completed hand with showdown reveals (seat -> cards). */
  observe?(h: HandState, reveals: Map<number, [CardId, CardId]>): void;
}

export interface SeatSetup { seat: number; playerId: string; policy: Policy; stack: number; sittingOut?: boolean }

export interface HandSetup {
  handId: string;
  seats: SeatSetup[];
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  straddle?: number;
  tableSeats?: number;
  /** Full 52-card deck order; cards are dealt seat by seat, then the board. */
  deck: CardId[];
  /** Seed for the policies' private randomness. */
  seed: number;
  /** Called after the blinds and after every action / street (replay fixtures, tests). */
  onStep?: (h: HandState, holes: Map<number, [CardId, CardId]>) => void;
}

export interface HandResult {
  h: HandState;
  holes: Map<number, [CardId, CardId]>;
  /** Net chips per seat (sums to zero). */
  nets: Map<number, number>;
  reveals: Map<number, [CardId, CardId]>;
  illegal: { seat: number; policy: string; code: string }[];
  /** Wall-clock decision latency per seat, ms. */
  latency: { seat: number; ms: number; street: string }[];
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function playHand(setup: HandSetup): Promise<HandResult> {
  const h = createHand({
    handId: setup.handId, tableSeats: setup.tableSeats ?? 10, buttonSeat: setup.buttonSeat,
    smallBlind: setup.smallBlind, bigBlind: setup.bigBlind, ante: setup.ante, straddle: setup.straddle,
    seats: setup.seats.map((s) => ({ seat: s.seat, playerId: s.playerId, stack: s.stack, sittingOut: s.sittingOut })),
  });
  const chips0 = totalChips(h);
  const dealt = h.seats.filter((s) => s.dealtIn);
  const holes = new Map<number, [CardId, CardId]>();
  let di = 0;
  for (const s of dealt) holes.set(s.seat, [setup.deck[di++], setup.deck[di++]]);
  const boardCards = setup.deck.slice(di, di + 5);
  const policyOf = new Map(setup.seats.map((s) => [s.seat, s.policy]));
  const illegal: HandResult['illegal'] = [];
  const latency: HandResult['latency'] = [];
  const baseRng = new Rng(setup.seed);

  setup.onStep?.(h, holes);
  let guard = 0;
  while (h.phase !== 'complete' && h.phase !== 'showdown') {
    if (++guard > 2000) throw new Error(`hand ${h.handId} did not terminate`);
    if (h.toAct !== null) {
      const seat = h.toAct;
      const policy = policyOf.get(seat)!;
      const la = legalActions(h)!;
      const t0 = nowMs();
      let choice: Omit<ActionInput, 'seat'>;
      try {
        choice = await policy.act({ h, seat, hole: holes.get(seat)!, la, rng: baseRng.fork(seat * 1000 + h.events.length) });
      } catch (e) {
        illegal.push({ seat, policy: policy.name, code: `threw:${(e as Error).message}`.slice(0, 80) });
        choice = { kind: la.canCheck ? 'check' : 'fold' };
      }
      latency.push({ seat, ms: nowMs() - t0, street: h.street });
      let input: ActionInput = { seat, ...choice };
      const err = validateAction(h, input);
      if (err) {
        illegal.push({ seat, policy: policy.name, code: err.code });
        input = { seat, kind: la.canCheck ? 'check' : 'fold' };
      }
      applyAction(h, input);
    } else if (awaitingBoard(h)) {
      dealBoard(h, h.street === 'preflop' ? boardCards.slice(0, 3) : [boardCards[h.board.length]]);
    } else throw new Error(`hand ${h.handId} stuck in phase ${h.phase}`);
    setup.onStep?.(h, holes);
  }

  const reveals = new Map<number, [CardId, CardId]>();
  if (h.phase === 'showdown') {
    const live = h.seats.filter((s) => s.dealtIn && !s.folded);
    const rank = new Map(live.map((s) => [s.seat, evaluateHand([...holes.get(s.seat)!, ...h.board])]));
    for (const s of live) reveals.set(s.seat, holes.get(s.seat)!);
    completeHand(h, (seat) => rank.get(seat)!);
    setup.onStep?.(h, holes);
  }
  const chips1 = totalChips(h);
  if (Math.abs(chips1 - chips0) > 1e-6) throw new Error(`chip conservation violated in ${h.handId}: ${chips0} -> ${chips1}`);
  const nets = new Map<number, number>();
  for (const s of h.seats) nets.set(s.seat, s.stack - s.startStack);
  for (const s of setup.seats) s.policy.observe?.(h, reveals);
  return { h, holes, nets, reveals, illegal, latency };
}

// ---- sessions -----------------------------------------------------------------

export interface BlindLevel { hands: number; smallBlind: number; bigBlind: number; ante?: number }

export interface SessionConfig {
  players: { playerId: string; policy: Policy }[];
  hands: number;
  seed: number;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  straddle?: number;
  /** Starting stack in chips (cash: every hand starts from this stack so hands are comparable). */
  startStack: number;
  /** Per-player starting stacks (overrides startStack). */
  stacks?: number[];
  /**
   * 'cash'       stacks reset every hand (bb/100 is well defined, no stack drift)
   * 'tournament' stacks carry over, busted players are removed, blinds follow `levels`
   */
  mode?: 'cash' | 'tournament';
  levels?: BlindLevel[];
  /** Rotate the same deck through every seat assignment (duplicate-style variance reduction). */
  duplicate?: boolean;
  onHand?: (r: HandResult, index: number) => void;
}

export interface PlayerTotals { playerId: string; policy: string; hands: number; net: number; sumSq: number; perDeal: number[] }

export interface SessionResult {
  totals: Map<string, PlayerTotals>;
  hands: number;
  illegal: HandResult['illegal'];
  latencyByPolicy: Map<string, number[]>;
  /** Tournament finishing order (first busted first), when mode = 'tournament'. */
  bustOrder: string[];
  winner: string | null;
}

export async function playSession(cfg: SessionConfig): Promise<SessionResult> {
  const n = cfg.players.length;
  if (n < 2 || n > 10) throw new RangeError('playSession: 2-10 players');
  const mode = cfg.mode ?? 'cash';
  const rng = new Rng(cfg.seed);
  const totals = new Map<string, PlayerTotals>(cfg.players.map((p) => [p.playerId, { playerId: p.playerId, policy: p.policy.name, hands: 0, net: 0, sumSq: 0, perDeal: [] }]));
  const illegal: HandResult['illegal'] = [];
  const latencyByPolicy = new Map<string, number[]>();
  const stacks = cfg.players.map((_, i) => cfg.stacks?.[i] ?? cfg.startStack);
  const bustOrder: string[] = [];
  let button = 0, played = 0, level = 0, levelHands = 0;

  for (let d = 0; played < cfg.hands; d++) {
    const deck = shuffledDeck(rng);
    const dealSeed = rng.int(1 << 30);
    const rotations = cfg.duplicate && mode === 'cash' ? n : 1;
    const dealNet = new Map<string, number>();
    for (let r = 0; r < rotations; r++) {
      let sb = cfg.smallBlind, bb = cfg.bigBlind, ante = cfg.ante;
      if (mode === 'tournament' && cfg.levels?.length) {
        const L = cfg.levels[Math.min(level, cfg.levels.length - 1)];
        sb = L.smallBlind; bb = L.bigBlind; ante = L.ante;
      }
      // Rotation r seats player (i + r) % n in physical seat i, so every player sees every seat's cards.
      const seats = cfg.players.map((_, i) => {
        const pi = (i + r) % n;
        return { seat: i, playerId: cfg.players[pi].playerId, policy: cfg.players[pi].policy, stack: mode === 'cash' ? (cfg.stacks?.[pi] ?? cfg.startStack) : stacks[pi], pi };
      }).filter((s) => s.stack > 0);
      if (seats.length < 2) break;
      const alive = seats.map((s) => s.seat);
      const btn = alive[button % alive.length];
      const res = await playHand({
        handId: `s${cfg.seed}-d${d}-r${r}`, seats, buttonSeat: btn, smallBlind: sb, bigBlind: bb, ante,
        straddle: cfg.straddle, tableSeats: Math.max(n, 2), deck, seed: dealSeed,
      });
      for (const s of seats) {
        const net = res.nets.get(s.seat) ?? 0;
        dealNet.set(s.playerId, (dealNet.get(s.playerId) ?? 0) + net / bb / rotations);
        if (mode === 'tournament') {
          stacks[s.pi] += net;
          if (stacks[s.pi] <= 1e-9 && !bustOrder.includes(s.playerId)) bustOrder.push(s.playerId);
        }
      }
      illegal.push(...res.illegal);
      for (const l of res.latency) {
        const name = seats.find((s) => s.seat === l.seat)!.policy.name;
        let arr = latencyByPolicy.get(name);
        if (!arr) { arr = []; latencyByPolicy.set(name, arr); }
        if (arr.length < 200000) arr.push(l.ms);
      }
      cfg.onHand?.(res, played);
      played++;
      if (mode === 'tournament' && cfg.levels?.length && ++levelHands >= cfg.levels[Math.min(level, cfg.levels.length - 1)].hands) { level++; levelHands = 0; }
    }
    button++;
    for (const [id, bbNet] of dealNet) {
      const t = totals.get(id)!;
      t.hands += rotations; t.net += bbNet * rotations; t.sumSq += bbNet * bbNet; t.perDeal.push(bbNet);
    }
    if (mode === 'tournament' && stacks.filter((s) => s > 1e-9).length < 2) break;
  }
  const aliveIdx = stacks.map((s, i) => (s > 1e-9 ? i : -1)).filter((i) => i >= 0);
  return { totals, hands: played, illegal, latencyByPolicy, bustOrder, winner: mode === 'tournament' && aliveIdx.length === 1 ? cfg.players[aliveIdx[0]].playerId : null };
}

export interface Bb100 { bb100: number; ci95: number; deals: number; sd: number }

/** bb/100 with a 95% confidence interval from per-deal results (each deal = one independent sample). */
export function bb100(perDeal: readonly number[]): Bb100 {
  const n = perDeal.length;
  if (n === 0) return { bb100: NaN, ci95: NaN, deals: 0, sd: NaN };
  let s = 0, q = 0;
  for (const x of perDeal) { s += x; q += x * x; }
  const mean = s / n;
  const variance = n > 1 ? Math.max(0, (q - n * mean * mean) / (n - 1)) : 0;
  const se = Math.sqrt(variance / n);
  return { bb100: 100 * mean, ci95: 196 * se, deals: n, sd: Math.sqrt(variance) };
}

/** Paired difference (A minus B) over the same deals: CI of the per-deal difference. */
export function pairedDiff(a: readonly number[], b: readonly number[]): Bb100 {
  const n = Math.min(a.length, b.length);
  const d: number[] = [];
  for (let i = 0; i < n; i++) d.push(a[i] - b[i]);
  return bb100(d);
}
