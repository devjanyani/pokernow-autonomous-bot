// ============================================================
// No-Limit Hold'em rules engine (2-10 players): a pure, validated state
// machine. It knows nothing about cards beyond the board count; dealing and
// hand ranking are supplied by the caller (simulator or reconstruction layer).
//
//   Waiting -> Preflop -> Flop -> Turn -> River -> Showdown -> Complete
//
// with early completion on folds and automatic run-outs when no further
// betting is possible. Both the offline simulator and the PokerNow
// reconstruction replay their events through this one engine, so the legal
// action bounds the bot computes are the same rules the simulator enforces.
// ============================================================

import { CardId, cardsAreDistinct } from '../cards';
import { assignPositions, SeatPosition } from './positions';
import { buildPots, PotBreakdown, settlePots } from './pots';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = 'waiting' | Street | 'showdown' | 'complete';
export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type EventKind = ActionKind | 'post-sb' | 'post-bb' | 'post-ante' | 'post-straddle';

export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

export interface SeatConfig {
  seat: number;
  playerId: string;
  name?: string;
  stack: number;
  /** Seated but not dealt in (sitting out / waiting for the big blind). */
  sittingOut?: boolean;
}

export interface HandConfig {
  handId: string;
  /** Number of seats at the table (2-10). Defaults to 10. */
  tableSeats?: number;
  /** Seats in CLOCKWISE order. */
  seats: SeatConfig[];
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  /** Ante posted by every dealt-in player. */
  ante?: number;
  /** A live straddle posted by the first seat left of the big blind (amount, usually 2bb). */
  straddle?: number;
  /** Game variant; anything but 'nlhe' is rejected. */
  variant?: string;
  /** Dead small blind: nobody posts it and the first dealt seat left of the button is the big blind. */
  noSmallBlind?: boolean;
}

export interface SeatState {
  seat: number;
  playerId: string;
  name: string;
  /** Chips behind (not yet in the pot). */
  stack: number;
  startStack: number;
  dealtIn: boolean;
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the CURRENT street (blinds count on preflop; antes never do). */
  streetCommit: number;
  /** Chips put in this whole hand (antes included). */
  totalCommit: number;
  actedThisRound: boolean;
  /** The bet level this seat last responded to; used for the re-open rule. */
  betLevelWhenActed: number;
  pos: SeatPosition | null;
}

export interface ActionEvent {
  /** Unique within the hand: `${handId}:${seq}`. */
  id: string;
  seq: number;
  seat: number;
  street: Street;
  kind: EventKind;
  /** Chips added to the pot by this event. */
  amount: number;
  /** Seat's street commitment after the event ("raise to" / "call to"). */
  to: number;
  allIn: boolean;
  /** False for forced posts and for the big blind checking its option. */
  voluntary: boolean;
  /** Pot size (all commitments) BEFORE the event. */
  potBefore: number;
  /** Amount the seat faced before acting. */
  facing: number;
}

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call (already capped by the seat's stack). */
  callAmount: number;
  canRaise: boolean;
  /** Smallest legal bet / raise-to (street commitment after the action). */
  minRaiseTo: number;
  /** Largest legal bet / raise-to: the seat's all-in. */
  maxRaiseTo: number;
  /** 'bet' when nobody has bet this street, otherwise 'raise'. */
  raiseKind: 'bet' | 'raise';
}

export interface HandState {
  handId: string;
  tableSeats: number;
  variant: 'nlhe';
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  straddle: number;
  phase: Phase;
  street: Street;
  board: CardId[];
  /** Every seated player this hand, clockwise (sitting-out seats included, dealtIn=false). */
  seats: SeatState[];
  /** Highest street commitment. */
  currentBet: number;
  /** Size of the last FULL bet or raise this street (minimum raise increment). */
  lastRaiseSize: number;
  /** Seat to act, or null when the engine waits for cards / is finished. */
  toAct: number | null;
  /** Seat of the last aggressor on each street (null if checked through). */
  aggressor: Record<Street, number | null>;
  /** Number of raises this street (preflop: the big blind / straddle is not a raise). */
  raisesThisStreet: number;
  events: ActionEvent[];
  /** Final payouts once phase === 'complete'. */
  payouts: Map<number, number> | null;
  /** True when the hand reached showdown with 2+ players. */
  wentToShowdown: boolean;
}

export class IllegalActionError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'IllegalActionError'; }
}
export class UnsupportedGameError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedGameError'; }
}

const EPS = 1e-9;

// ---- construction ----------------------------------------------------------

export function createHand(cfg: HandConfig): HandState {
  const variant = (cfg.variant ?? 'nlhe').toLowerCase();
  if (variant !== 'nlhe') throw new UnsupportedGameError(`unsupported game variant "${cfg.variant}" (only No-Limit Hold'em)`);
  const tableSeats = cfg.tableSeats ?? 10;
  if (tableSeats < 2 || tableSeats > 10) throw new RangeError(`tableSeats ${tableSeats} outside 2-10`);
  if (!(cfg.bigBlind > 0) || !(cfg.smallBlind >= 0) || cfg.smallBlind > cfg.bigBlind) throw new RangeError('invalid blinds');
  if (new Set(cfg.seats.map((s) => s.seat)).size !== cfg.seats.length) throw new RangeError('duplicate seat number');
  if (cfg.seats.length > tableSeats) throw new RangeError('more players than seats');

  const seats: SeatState[] = cfg.seats.map((s) => ({
    seat: s.seat, playerId: s.playerId, name: s.name ?? s.playerId,
    stack: s.stack, startStack: s.stack,
    dealtIn: !s.sittingOut && s.stack > 0,
    folded: false, allIn: false, streetCommit: 0, totalCommit: 0,
    actedThisRound: false, betLevelWhenActed: 0, pos: null,
  }));
  const dealt = seats.filter((s) => s.dealtIn);
  if (dealt.length < 2) throw new RangeError(`need at least 2 dealt-in players, got ${dealt.length}`);
  if (dealt.length > 10) throw new RangeError('more than 10 dealt-in players');

  const h: HandState = {
    handId: cfg.handId, tableSeats, variant: 'nlhe', buttonSeat: cfg.buttonSeat,
    smallBlind: cfg.smallBlind, bigBlind: cfg.bigBlind, ante: cfg.ante ?? 0, straddle: 0,
    phase: 'preflop', street: 'preflop', board: [], seats,
    currentBet: 0, lastRaiseSize: cfg.bigBlind, toAct: null,
    aggressor: { preflop: null, flop: null, turn: null, river: null },
    raisesThisStreet: 0, events: [], payouts: null, wentToShowdown: false,
  };

  const dealtSeats = dealt.map((s) => s.seat);
  // Straddle only when 3+ players: the seat left of the big blind.
  let straddleSeat: number | null = null;
  const noSmallBlind = !!cfg.noSmallBlind && dealt.length > 2;
  const base = assignPositions(dealtSeats, cfg.buttonSeat, { noSmallBlind });
  if (cfg.straddle && cfg.straddle > cfg.bigBlind && dealt.length >= 3) {
    straddleSeat = base.find((p) => p.preflopOrder === 0)!.seat;
  }
  const positions = straddleSeat === null ? base : assignPositions(dealtSeats, cfg.buttonSeat, { straddleSeat, noSmallBlind });
  for (const p of positions) seatOf(h, p.seat).pos = p;

  if (h.ante > 0) for (const s of dealt) post(h, s, h.ante, 'post-ante');
  const sb = dealt.find((s) => s.pos!.isSmallBlind);
  const bb = dealt.find((s) => s.pos!.isBigBlind)!;
  if (sb) post(h, sb, cfg.smallBlind, 'post-sb');
  post(h, bb, cfg.bigBlind, 'post-bb');
  h.currentBet = cfg.bigBlind;
  h.lastRaiseSize = cfg.bigBlind;
  if (straddleSeat !== null) {
    post(h, seatOf(h, straddleSeat), cfg.straddle!, 'post-straddle');
    h.straddle = cfg.straddle!;
    h.currentBet = cfg.straddle!;
    h.lastRaiseSize = cfg.straddle!;
  }
  h.toAct = nextToAct(h, null);
  if (h.toAct === null) finishBettingRound(h);
  return h;
}

function post(h: HandState, s: SeatState, amount: number, kind: EventKind): void {
  const potBefore = potTotal(h);
  const a = Math.min(amount, s.stack);
  s.stack -= a;
  s.totalCommit += a;
  if (kind !== 'post-ante') s.streetCommit += a;
  if (s.stack <= EPS) { s.stack = 0; s.allIn = true; }
  pushEvent(h, s, kind, a, false, potBefore, 0);
}

function pushEvent(h: HandState, s: SeatState, kind: EventKind, amount: number, voluntary: boolean, potBefore: number, facing: number): ActionEvent {
  const seq = h.events.length;
  const ev: ActionEvent = {
    id: `${h.handId}:${seq}`, seq, seat: s.seat, street: h.street, kind, amount,
    to: s.streetCommit, allIn: s.allIn, voluntary, potBefore, facing,
  };
  h.events.push(ev);
  return ev;
}

// ---- queries ----------------------------------------------------------------

export function seatOf(h: HandState, seat: number): SeatState {
  const s = h.seats.find((x) => x.seat === seat);
  if (!s) throw new RangeError(`no player in seat ${seat}`);
  return s;
}

export function potTotal(h: HandState): number {
  let t = 0;
  for (const s of h.seats) t += s.totalCommit;
  return t;
}

/** Dealt-in seats in order of action for the current street. */
export function actionOrder(h: HandState): SeatState[] {
  const key = h.street === 'preflop' ? 'preflopOrder' : 'postflopOrder';
  return h.seats.filter((s) => s.dealtIn).sort((a, b) => a.pos![key] - b.pos![key]);
}

const canStillAct = (s: SeatState) => s.dealtIn && !s.folded && !s.allIn;
const needsToAct = (h: HandState, s: SeatState) => canStillAct(s) && (!s.actedThisRound || s.streetCommit < h.currentBet - EPS);

function nextToAct(h: HandState, afterSeat: number | null): number | null {
  const live = h.seats.filter((s) => s.dealtIn && !s.folded);
  if (live.length <= 1) return null;
  const actors = live.filter((s) => !s.allIn);
  if (actors.length === 0) return null;
  // A lone player with chips who has matched every bet has nobody to bet against.
  if (actors.length === 1 && actors[0].streetCommit >= h.currentBet - EPS) return null;
  const order = actionOrder(h);
  const start = afterSeat === null ? 0 : (order.findIndex((s) => s.seat === afterSeat) + 1) % order.length;
  for (let k = 0; k < order.length; k++) {
    const s = order[(start + k) % order.length];
    if (needsToAct(h, s)) return s.seat;
  }
  return null;
}

export function legalActions(h: HandState, seat: number | null = h.toAct): LegalActions | null {
  if (seat === null || h.toAct !== seat) return null;
  const s = seatOf(h, seat);
  const toCall = Math.max(0, h.currentBet - s.streetCommit);
  const callAmount = Math.min(toCall, s.stack);
  const maxRaiseTo = s.streetCommit + s.stack;
  // Someone else must be able to respond to a raise.
  const opponentsWithChips = h.seats.some((o) => o.seat !== seat && canStillAct(o));
  // Re-open rule: a seat that already acted may raise again only if the bet has
  // grown by at least one full raise since it acted (cumulative short all-ins count).
  const reopened = !s.actedThisRound || h.currentBet - s.betLevelWhenActed >= h.lastRaiseSize - EPS;
  const canRaise = opponentsWithChips && reopened && maxRaiseTo > h.currentBet + EPS;
  const minFull = h.currentBet > 0 ? h.currentBet + h.lastRaiseSize : Math.min(h.bigBlind, maxRaiseTo);
  return {
    seat,
    canFold: true,
    canCheck: toCall <= EPS,
    canCall: toCall > EPS && s.stack > 0,
    callAmount,
    canRaise,
    minRaiseTo: canRaise ? Math.min(Math.max(minFull, 0), maxRaiseTo) : 0,
    maxRaiseTo: canRaise ? maxRaiseTo : 0,
    raiseKind: h.currentBet > 0 ? 'raise' : 'bet',
  };
}

/** Snap a desired raise-to into the legal window (or null if raising is not legal). */
export function clampRaiseTo(la: LegalActions, desired: number, chipUnit = 1): number | null {
  if (!la.canRaise) return null;
  let to = Math.round(desired / chipUnit) * chipUnit;
  if (!(to >= la.minRaiseTo)) to = la.minRaiseTo;
  if (to > la.maxRaiseTo) to = la.maxRaiseTo;
  return to;
}

export interface TableCounts {
  seatsAvailable: number;
  seated: number;
  dealtIn: number;
  folded: number;
  /** Players still contesting the pot (not folded), all-in players included. */
  contesting: number;
  allIn: number;
  /** Players who can still make betting decisions. */
  canAct: number;
  opponentsContesting: number;
  /** Opponents who still have to act on the current street before the round can close. */
  opponentsToActThisStreet: number;
  /** True when exactly two players were dealt in (true heads-up table rules). */
  headsUpTable: boolean;
  /** Pot structure right now: 'heads-up' (hero + 1), 'multiway' (hero + 2 or more), or 'uncontested'. */
  potType: 'heads-up' | 'multiway' | 'uncontested';
}

export function tableCounts(h: HandState, heroSeat: number): TableCounts {
  const dealt = h.seats.filter((s) => s.dealtIn);
  const live = dealt.filter((s) => !s.folded);
  const opp = live.filter((s) => s.seat !== heroSeat);
  const heroLive = live.some((s) => s.seat === heroSeat);
  const n = heroLive ? opp.length : Math.max(0, live.length - 1);
  return {
    seatsAvailable: h.tableSeats,
    seated: h.seats.length,
    dealtIn: dealt.length,
    folded: dealt.length - live.length,
    contesting: live.length,
    allIn: live.filter((s) => s.allIn).length,
    canAct: live.filter((s) => !s.allIn).length,
    opponentsContesting: opp.length,
    opponentsToActThisStreet: h.toAct === null ? 0 : opp.filter((s) => s.seat !== h.toAct && needsToAct(h, s)).length,
    headsUpTable: dealt.length === 2,
    potType: n === 0 ? 'uncontested' : n === 1 ? 'heads-up' : 'multiway',
  };
}

// ---- transitions -----------------------------------------------------------

export interface ActionInput {
  seat: number;
  kind: ActionKind;
  /** For bet/raise: street commitment after the action. */
  to?: number;
}

/** Validate without mutating. Returns null when legal, else an error. */
export function validateAction(h: HandState, a: ActionInput): IllegalActionError | null {
  if (h.phase === 'complete' || h.phase === 'showdown' || h.phase === 'waiting') return new IllegalActionError(`hand is in phase ${h.phase}`, 'phase');
  if (h.toAct === null) return new IllegalActionError('no seat is to act', 'no-actor');
  if (a.seat !== h.toAct) return new IllegalActionError(`seat ${a.seat} acted out of turn (to act: ${h.toAct})`, 'out-of-turn');
  const la = legalActions(h)!;
  switch (a.kind) {
    case 'fold': return null;
    case 'check': return la.canCheck ? null : new IllegalActionError('cannot check facing a bet', 'check-facing-bet');
    case 'call': return la.canCall ? null : new IllegalActionError('nothing to call', 'no-call');
    case 'bet':
    case 'raise': {
      if (!la.canRaise) return new IllegalActionError('raising is not open to this seat', 'raise-closed');
      if (a.kind !== la.raiseKind) return new IllegalActionError(`expected ${la.raiseKind}, got ${a.kind}`, 'bet-vs-raise');
      const to = a.to;
      if (to === undefined || !Number.isFinite(to)) return new IllegalActionError('bet/raise needs an amount', 'no-amount');
      if (to > la.maxRaiseTo + EPS) return new IllegalActionError(`raise to ${to} exceeds stack (max ${la.maxRaiseTo})`, 'over-stack');
      if (to < la.minRaiseTo - EPS && to < la.maxRaiseTo - EPS) return new IllegalActionError(`raise to ${to} below minimum ${la.minRaiseTo}`, 'under-min');
      if (to <= h.currentBet + EPS) return new IllegalActionError('raise does not exceed the current bet', 'not-a-raise');
      return null;
    }
  }
}

export function applyAction(h: HandState, a: ActionInput): ActionEvent {
  const err = validateAction(h, a);
  if (err) throw err;
  const s = seatOf(h, a.seat);
  const potBefore = potTotal(h);
  const facing = Math.max(0, h.currentBet - s.streetCommit);
  let paid = 0;
  let voluntary = true;
  switch (a.kind) {
    case 'fold':
      s.folded = true;
      break;
    case 'check':
      // The big blind (or straddler) checking its option is not a voluntary action.
      voluntary = h.street !== 'preflop';
      break;
    case 'call':
      paid = Math.min(facing, s.stack);
      break;
    case 'bet':
    case 'raise': {
      const to = a.to!;
      paid = to - s.streetCommit;
      const raiseSize = to - h.currentBet;
      if (raiseSize >= h.lastRaiseSize - EPS) h.lastRaiseSize = raiseSize; // full raise
      h.currentBet = to;
      h.aggressor[h.street] = s.seat;
      h.raisesThisStreet++;
      break;
    }
  }
  s.stack -= paid;
  s.streetCommit += paid;
  s.totalCommit += paid;
  if (s.stack <= EPS && !s.folded) { s.stack = 0; s.allIn = true; }
  s.actedThisRound = true;
  s.betLevelWhenActed = h.currentBet;
  const ev = pushEvent(h, s, a.kind, paid, voluntary, potBefore, facing);

  if (h.seats.filter((x) => x.dealtIn && !x.folded).length <= 1) {
    completeHand(h, () => 0);
    return ev;
  }
  h.toAct = nextToAct(h, s.seat);
  if (h.toAct === null) finishBettingRound(h);
  return ev;
}

function finishBettingRound(h: HandState): void {
  h.toAct = null;
  if (h.street === 'river') h.phase = 'showdown';
  // Otherwise the engine waits for dealBoard(); phase stays on the current street.
}

/** True when betting on this street is over and the next board card(s) are due. */
export function awaitingBoard(h: HandState): boolean {
  return h.toAct === null && h.phase !== 'complete' && h.phase !== 'showdown' && h.phase !== 'waiting';
}

/** True when no further betting can happen this hand (all-in run-out). */
export function bettingClosed(h: HandState): boolean {
  const live = h.seats.filter((s) => s.dealtIn && !s.folded);
  return live.filter((s) => !s.allIn).length <= 1 && live.every((s) => s.allIn || s.streetCommit >= h.currentBet - EPS);
}

/** Deal the next street. `cards` is the flop (3 cards) or the turn/river card (1). */
export function dealBoard(h: HandState, cards: readonly CardId[]): void {
  if (!awaitingBoard(h)) throw new IllegalActionError('board dealt while betting is still open', 'board-early');
  const need = h.street === 'preflop' ? 3 : 1;
  if (cards.length !== need) throw new IllegalActionError(`expected ${need} board card(s), got ${cards.length}`, 'board-count');
  if (!cardsAreDistinct([...h.board, ...cards])) throw new IllegalActionError('duplicate or invalid board card', 'board-duplicate');
  h.board.push(...cards);
  h.street = STREETS[STREETS.indexOf(h.street) + 1];
  h.phase = h.street;
  h.currentBet = 0;
  h.lastRaiseSize = h.bigBlind;
  h.raisesThisStreet = 0;
  for (const s of h.seats) { s.streetCommit = 0; s.actedThisRound = false; s.betLevelWhenActed = 0; }
  h.toAct = nextToAct(h, null);
  if (h.toAct === null) finishBettingRound(h);
}

export function potBreakdown(h: HandState): PotBreakdown {
  return buildPots(h.seats.filter((s) => s.dealtIn).map((s) => ({ seat: s.seat, committed: s.totalCommit, folded: s.folded })));
}

/** Smallest chip denomination implied by the blinds (for odd-chip handling). */
export function chipUnit(h: HandState): number {
  const frac = (x: number) => Math.abs(x - Math.round(x)) > 1e-6;
  if (frac(h.bigBlind * 10) || frac(h.smallBlind * 10)) return 0.01;
  if (frac(h.bigBlind) || frac(h.smallBlind)) return 0.1;
  return 1;
}

/**
 * Settle the hand. `strength(seat)` ranks each non-folded seat's hand (higher
 * wins); it is not called when a single player remains.
 */
export function completeHand(h: HandState, strength: (seat: number) => number): Map<number, number> {
  if (h.phase === 'complete') return h.payouts!;
  const live = h.seats.filter((s) => s.dealtIn && !s.folded);
  if (live.length > 1 && h.phase !== 'showdown') throw new IllegalActionError('showdown before the river betting is complete', 'early-showdown');
  const order = h.seats.filter((s) => s.dealtIn).sort((a, b) => a.pos!.postflopOrder - b.pos!.postflopOrder).map((s) => s.seat);
  const payouts = settlePots(potBreakdown(h), live.length > 1 ? strength : () => 0, order, chipUnit(h));
  for (const [seat, amt] of payouts) seatOf(h, seat).stack += amt;
  h.wentToShowdown = live.length > 1;
  h.payouts = payouts;
  h.phase = 'complete';
  h.toAct = null;
  return payouts;
}

/** Sum of stacks plus pot: invariant across a hand (chip conservation check). */
export function totalChips(h: HandState): number {
  let t = 0;
  for (const s of h.seats) t += s.stack + (h.phase === 'complete' ? 0 : s.totalCommit);
  return t;
}

/** Effective stack (chips behind + street commitment) between a seat and the live opponents. */
export function effectiveStack(h: HandState, seat: number): number {
  const me = seatOf(h, seat);
  const mine = me.stack + me.streetCommit;
  let opp = 0;
  for (const s of h.seats) if (s.seat !== seat && s.dealtIn && !s.folded) opp = Math.max(opp, s.stack + s.streetCommit);
  return Math.min(mine, opp);
}

export function cloneHand(h: HandState): HandState {
  return {
    ...h,
    board: h.board.slice(),
    seats: h.seats.map((s) => ({ ...s })),
    aggressor: { ...h.aggressor },
    events: h.events.slice(),
    payouts: h.payouts ? new Map(h.payouts) : null,
  };
}
