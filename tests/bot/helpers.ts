import { applyAction, createHand, HandState } from '../../src/bot/table/engine';

export function mk(n: number, opts: { stacks?: number[]; button?: number; sb?: number; bb?: number; ante?: number; straddle?: number; sitOut?: number[]; seats?: number[]; id?: string } = {}): HandState {
  const seats = opts.seats ?? Array.from({ length: n }, (_, i) => i);
  return createHand({
    handId: opts.id ?? 'h1', buttonSeat: opts.button ?? seats[0], smallBlind: opts.sb ?? 10, bigBlind: opts.bb ?? 20, ante: opts.ante, straddle: opts.straddle,
    seats: seats.map((seat, i) => ({ seat, playerId: `p${seat}`, stack: opts.stacks?.[i] ?? 2000, sittingOut: opts.sitOut?.includes(seat) })),
  });
}
export const act = (h: HandState, kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to?: number) => applyAction(h, { seat: h.toAct!, kind, to });
