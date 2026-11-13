// ============================================================
// Range estimate for every opponent still contesting the pot:
//   preflop line -> percentile-band range (ranges/preflop-model.ts)
//   each postflop action -> Bayesian narrowing (ranges/postflop-model.ts)
//   Hero's cards and the board removed (card removal).
// All-in opponents stay in the list: they cannot act but still hold equity.
// ============================================================

import { CardId } from '../cards';
import { HandState, Street } from '../table/engine';
import { PlayerProfile, tendencies } from '../opponents/profile';
import { BoardFeatures, computeFeatures, actionLikelihood, ObservedKind, Tendencies } from '../ranges/postflop-model';
import { opponentPreflopRange } from '../ranges/preflop-model';
import { describeRange, multiplyInto, Range, rangeTotal, removeDead } from '../ranges/range';

export interface VillainModel {
  seat: number;
  playerId: string;
  name: string;
  range: Range;
  line: string;
  tend: Tendencies;
  stack: number;
  streetCommit: number;
  totalCommit: number;
  allIn: boolean;
  /** Still has to act on this street after Hero (not yet closed). */
  actsBehind: boolean;
  summary: string;
}

export class FeatureCache {
  private readonly m = new Map<string, BoardFeatures>();
  get(board: readonly CardId[]): BoardFeatures {
    const key = board.join(',');
    let f = this.m.get(key);
    if (!f) { f = computeFeatures(board); this.m.set(key, f); if (this.m.size > 8) this.m.delete(this.m.keys().next().value as string); }
    return f;
  }
}

const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

export function buildVillains(
  h: HandState,
  heroSeat: number,
  heroCards: [CardId, CardId],
  profiles: Map<string, PlayerProfile>,
  exploitWeight: number,
  cache: FeatureCache,
): VillainModel[] {
  const out: VillainModel[] = [];
  const hero = h.seats.find((s) => s.seat === heroSeat)!;
  const orderKey = h.street === 'preflop' ? 'preflopOrder' : 'postflopOrder';
  for (const s of h.seats) {
    if (!s.dealtIn || s.folded || s.seat === heroSeat) continue;
    const tend = tendencies(profiles.get(s.playerId), exploitWeight);
    const { range, line } = opponentPreflopRange(h, s.seat, tend);
    const lineParts: string[] = [line.kind];

    // Narrow through every postflop action this seat has taken.
    let liveOpp = h.seats.filter((x) => x.dealtIn).length - 1;
    let street: Street = 'preflop';
    let aggThisStreet = 0;
    for (const e of h.events) {
      if (e.street !== street) { street = e.street; aggThisStreet = 0; }
      if (e.kind.startsWith('post')) continue;
      if (e.street !== 'preflop' && e.seat === s.seat && e.kind !== 'fold') {
        const board = h.board.slice(0, BOARD_LEN[e.street]);
        if (board.length >= 3) {
          const f = cache.get(board);
          const facedRaise = aggThisStreet >= 2;
          const betFrac = e.kind === 'bet'
            ? e.amount / Math.max(h.bigBlind, e.potBefore)
            : e.facing / Math.max(h.bigBlind, e.potBefore - e.facing);
          const ctx = { street: e.street, betFrac, opponents: Math.max(1, liveOpp), isRaise: facedRaise, tend };
          const kind = e.kind as ObservedKind;
          multiplyInto(range, (k) => (f.es[k] < 0 ? 0 : actionLikelihood(kind, f.es[k], ctx)));
          lineParts.push(`${e.street[0]}:${e.kind}`);
        }
      }
      if (e.kind === 'bet' || e.kind === 'raise') aggThisStreet++;
      if (e.kind === 'fold') liveOpp--;
    }
    let final = removeDead(range, [...heroCards, ...h.board]);
    if (rangeTotal(final) < 1e-6) final = removeDead(opponentPreflopRange(h, s.seat, tend).range, [...heroCards, ...h.board]);
    const closed = s.allIn || (s.actedThisRound && s.streetCommit >= h.currentBet - 1e-9);
    out.push({
      seat: s.seat, playerId: s.playerId, name: s.name, range: final, line: lineParts.join(' '), tend,
      stack: s.stack, streetCommit: s.streetCommit, totalCommit: s.totalCommit, allIn: s.allIn,
      actsBehind: !closed && s.pos![orderKey] !== hero.pos![orderKey],
      summary: describeRange(final),
    });
  }
  return out;
}
