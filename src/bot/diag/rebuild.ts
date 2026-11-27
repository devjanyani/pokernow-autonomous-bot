// ============================================================
// Rebuild a HandState from a stored hand record (the per-hand summary inside a
// debug bundle or the dashboard's hand history), up to any point in the hand.
//
// Everything used here was visible at the table: seats, stacks, positions,
// the recorded actions, the board and Hero's own cards. Positions are taken
// from the recorded labels, so the rebuild reproduces what the live tracker
// reconstructed, including a dead small blind.
// ============================================================

import { CardId, parseCardStrict } from '../cards';
import { ActionKind, applyAction, awaitingBoard, createHand, dealBoard, HandState } from '../table/engine';

export interface RecordedSeat { seat: number; name?: string; playerId?: string; position: string | null; startStack: number; dealtIn: boolean }
export interface RecordedEvent { seq: number; seat: number; street: string; kind: string; amount: number; to: number }
export interface RecordedHand {
  handId: string;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  board: string[];
  seats: RecordedSeat[];
  events: RecordedEvent[];
  heroSeat: number | null;
  heroCards: string[] | null;
}

const card = (s: string): CardId => {
  const c = parseCardStrict(s);
  if (c === null) throw new Error(`bad card "${s}"`);
  return c;
};

/**
 * Replay the recorded hand until `eventCount` events exist (forced posts count),
 * dealing the recorded board cards when a street closes. Throws when the record
 * cannot be replayed by the rules engine; it never invents an action.
 */
export function rebuildHand(rec: RecordedHand, eventCount = rec.events.length): HandState {
  const button = rec.seats.find((s) => s.dealtIn && s.position === 'BTN') ?? rec.seats.find((s) => s.dealtIn && s.position === 'SB');
  if (!button) throw new Error(`${rec.handId}: no button seat in the record`);
  const dealt = rec.seats.filter((s) => s.dealtIn);
  const noSmallBlind = dealt.length > 2 && !rec.events.some((e) => e.kind === 'post-sb');
  // Entry / re-entry posts (live and dead), as the tracker recorded them.
  const extra = new Map<number, { seat: number; live: number; dead: number }>();
  for (const e of rec.events) {
    if (e.kind !== 'post-live' && e.kind !== 'post-dead') continue;
    const x = extra.get(e.seat) ?? { seat: e.seat, live: 0, dead: 0 };
    if (e.kind === 'post-live') x.live += e.amount; else x.dead += e.amount;
    extra.set(e.seat, x);
  }
  const h = createHand({
    handId: rec.handId, buttonSeat: button.seat, smallBlind: rec.smallBlind, bigBlind: rec.bigBlind, ante: rec.ante ?? 0, noSmallBlind,
    ...(extra.size ? { extraPosts: [...extra.values()] } : {}),
    seats: rec.seats.map((s) => ({ seat: s.seat, playerId: s.playerId ?? `seat${s.seat}`, name: s.name ?? `P${s.seat}`, stack: s.startStack, sittingOut: !s.dealtIn })),
  });
  const board = rec.board.map(card);
  const deal = () => {
    while (awaitingBoard(h) && h.events.length < eventCount) {
      const need = h.street === 'preflop' ? 3 : 1;
      if (board.length < h.board.length + need) return;
      dealBoard(h, board.slice(h.board.length, h.board.length + need));
    }
  };
  for (const e of rec.events) {
    if (h.events.length >= eventCount) break;
    if (e.kind.startsWith('post')) {
      const mine = h.events[e.seq];
      if (!mine || mine.kind !== e.kind || mine.seat !== e.seat) throw new Error(`${rec.handId}: forced post ${e.seq} does not match the rebuilt hand`);
      continue;
    }
    deal();
    if (h.toAct !== e.seat) throw new Error(`${rec.handId}: event ${e.seq} is seat ${e.seat} but the rules engine expects seat ${h.toAct}`);
    applyAction(h, { seat: e.seat, kind: e.kind as ActionKind, to: e.kind === 'bet' || e.kind === 'raise' ? e.to : undefined });
  }
  deal();
  return h;
}

export function recordedHeroCards(rec: RecordedHand): [CardId, CardId] | null {
  return rec.heroCards && rec.heroCards.length === 2 ? [card(rec.heroCards[0]), card(rec.heroCards[1])] : null;
}

/** Copy of a record with names and ids replaced by seat labels (for committed fixtures). */
export function anonymiseRecord<T extends RecordedHand>(rec: T, handId: string): RecordedHand {
  return {
    handId, smallBlind: rec.smallBlind, bigBlind: rec.bigBlind, ante: rec.ante ?? 0, board: rec.board.slice(),
    seats: rec.seats.map((s) => ({ seat: s.seat, name: `P${s.seat}`, playerId: `p${s.seat}`, position: s.position, startStack: s.startStack, dealtIn: s.dealtIn })),
    events: rec.events.map((e) => ({ seq: e.seq, seat: e.seat, street: e.street, kind: e.kind, amount: e.amount, to: e.to })),
    heroSeat: rec.heroSeat, heroCards: rec.heroCards ? rec.heroCards.slice() : null,
  };
}
