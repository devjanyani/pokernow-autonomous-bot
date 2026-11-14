// ============================================================
// Range estimate for every opponent still contesting the pot:
//   preflop line -> percentile-band range (ranges/preflop-model.ts)
//   each postflop action -> Bayesian narrowing (ranges/postflop-model.ts)
//   Hero's cards and the board removed (card removal).
// All-in opponents stay in the list: they cannot act but still hold equity.
// ============================================================

import { CardId } from '../cards';
import { HandState, Street, STREETS } from '../table/engine';
import { PlayerProfile, tendencies } from '../opponents/profile';
import { BetRole, BoardFeatures, computeFeatures, actionLikelihood, NEUTRAL, ObservedKind, Tendencies } from '../ranges/postflop-model';
import { opponentPreflopRange } from '../ranges/preflop-model';
import { actionLikelihood2, mixRanges, strengthTable } from '../ranges/range-model';
import { describeRange, multiplyInto, Range, rangeTotal, removeDead } from '../ranges/range';
import { defaultLibrary } from './library/builtin';

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
  /** Where the preflop part of the range came from. */
  rangeBasis: 'precomputed-chart' | 'solver' | 'computed' | 'heuristic';
  rangeSource: string;
  /** Share of the preflop range (by weight) left after narrowing through the postflop actions. */
  retained: number;
  /** True when the observed line is poorly explained by the behaviour model and the range was widened. */
  poorFit: boolean;
}

/** Below this retained share the narrowing is treated as a poor fit. HEURISTIC. */
export const POOR_FIT = 0.03;

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

export interface TableModel {
  villains: VillainModel[];
  /**
   * The range the model gives HERO from Hero's own betting line (board removed, Hero's cards NOT removed):
   * what the opponents can put Hero on. Version 2 uses it to measure opponents' hands against Hero's range.
   */
  heroPerceived: Range;
}

/** Narrow one seat's preflop range through every postflop action it has taken. */
function narrowSeat(
  h: HandState, seat: number, start: Range, tend: Tendencies, cache: FeatureCache, legacy: boolean, oppMix: Range | null, lineParts: string[],
): Range {
  const range = new Float64Array(start);
  let liveOpp = h.seats.filter((x) => x.dealtIn).length - 1;
  let street: Street = 'preflop';
  let aggThisStreet = 0;
  // Betting lead at the time of each action: the previous street's last aggressor, while still in the hand.
  const gone = new Set<number>();
  let acted = new Set<number>();
  let lead: number | null = null;
  for (const e of h.events) {
    if (e.street !== street) {
      const prev = h.aggressor[STREETS[STREETS.indexOf(e.street) - 1]];
      street = e.street; aggThisStreet = 0; acted = new Set();
      lead = prev !== null && !gone.has(prev) ? prev : null;
    }
    if (e.kind.startsWith('post')) continue;
    if (e.street !== 'preflop' && e.seat === seat && e.kind !== 'fold') {
      const board = h.board.slice(0, BOARD_LEN[e.street]);
      if (board.length >= 3) {
        const f = cache.get(board);
        const facedRaise = aggThisStreet >= 2;
        const betFrac = e.kind === 'bet'
          ? e.amount / Math.max(h.bigBlind, e.potBefore)
          : e.facing / Math.max(h.bigBlind, e.potBefore - e.facing);
        const role: BetRole | undefined = legacy ? undefined : aggThisStreet > 0 || lead === null ? 'neutral'
          : e.seat === lead ? 'aggressor' : acted.has(lead) || gone.has(lead) ? 'neutral' : 'into-aggressor';
        const ctx = { street: e.street, betFrac, opponents: Math.max(1, liveOpp), isRaise: facedRaise, tend, role };
        const kind = e.kind as ObservedKind;
        if (legacy || !oppMix) multiplyInto(range, (k) => (f.es[k] < 0 ? 0 : actionLikelihood(kind, f.es[k], ctx)));
        else {
          // Version 2: each holding is judged inside the range the player has at this moment and against the others' ranges.
          const st = strengthTable(range, oppMix, f);
          multiplyInto(range, (k) => (st[k] < 0 ? 0 : actionLikelihood2(kind, st[k], ctx)));
        }
        lineParts.push(`${e.street[0]}:${e.kind}`);
      }
    }
    if (e.kind === 'bet' || e.kind === 'raise') aggThisStreet++;
    if (e.kind === 'fold') { liveOpp--; gone.add(e.seat); }
    acted.add(e.seat);
  }
  return range;
}

export function buildVillains(
  h: HandState, heroSeat: number, heroCards: [CardId, CardId], profiles: Map<string, PlayerProfile>, exploitWeight: number, cache: FeatureCache, legacy = false,
): VillainModel[] {
  return buildTable(h, heroSeat, heroCards, profiles, exploitWeight, cache, legacy).villains;
}

export function buildTable(
  h: HandState,
  heroSeat: number,
  heroCards: [CardId, CardId],
  profiles: Map<string, PlayerProfile>,
  exploitWeight: number,
  cache: FeatureCache,
  /** Version 1 behaviour for the benchmark baseline: absolute strength only, no betting-lead roles, percentile preflop ranges. */
  legacy = false,
): TableModel {
  const out: VillainModel[] = [];
  const hero = h.seats.find((s) => s.seat === heroSeat)!;
  const orderKey = h.street === 'preflop' ? 'preflopOrder' : 'postflopOrder';
  const lib = legacy ? undefined : defaultLibrary();
  // Preflop ranges of everyone still in the hand, Hero included (Hero's is the range of Hero's LINE, not Hero's cards).
  const live = h.seats.filter((s) => s.dealtIn && !s.folded);
  const pre = new Map(live.map((s) => {
    const tend = s.seat === heroSeat ? NEUTRAL : tendencies(profiles.get(s.playerId), exploitWeight);
    return [s.seat, { tend, est: opponentPreflopRange(h, s.seat, tend, lib) }] as const;
  }));
  const postflop = h.board.length >= 3 && !legacy;
  const mixFor = (seat: number): Range | null => (postflop ? mixRanges(live.filter((s) => s.seat !== seat).map((s) => removeDead(pre.get(s.seat)!.est.range, h.board))) : null);

  for (const s of live) {
    if (s.seat === heroSeat) continue;
    const { tend, est } = pre.get(s.seat)!;
    const { line, basis: rangeBasis, source: rangeSource } = est;
    const lineParts: string[] = [line.kind];
    const range = narrowSeat(h, s.seat, est.range, tend, cache, legacy, mixFor(s.seat), lineParts);
    let final = removeDead(range, [...heroCards, ...h.board]);
    const start = removeDead(est.range, [...heroCards, ...h.board]);
    const startTotal = rangeTotal(start);
    let retained = startTotal > 0 ? rangeTotal(final) / startTotal : 1;
    if (rangeTotal(final) < 1e-6) { final = start; retained = 0; }
    // A line the behaviour model finds very unlikely leaves almost nothing of the range. That says more about
    // the model than about the player, so part of the starting range is mixed back in and the fit is flagged.
    let poorFit = false;
    if (!legacy && retained < POOR_FIT) {
      poorFit = true;
      const lambda = Math.min(0.5, 1 - retained / POOR_FIT);
      const ft = rangeTotal(final);
      if (ft > 0 && startTotal > 0) {
        const k = (lambda / (1 - lambda)) * (ft / startTotal);
        for (let i = 0; i < final.length; i++) final[i] += k * start[i];
      }
    }
    const closed = s.allIn || (s.actedThisRound && s.streetCommit >= h.currentBet - 1e-9);
    out.push({
      seat: s.seat, playerId: s.playerId, name: s.name, range: final, line: lineParts.join(' '), tend,
      stack: s.stack, streetCommit: s.streetCommit, totalCommit: s.totalCommit, allIn: s.allIn,
      actsBehind: !closed && s.pos![orderKey] !== hero.pos![orderKey],
      summary: describeRange(final), rangeBasis, rangeSource, retained, poorFit,
    });
  }
  let heroPerceived: Range;
  {
    const { est } = pre.get(heroSeat) ?? { est: null };
    heroPerceived = est ? removeDead(narrowSeat(h, heroSeat, est.range, NEUTRAL, cache, legacy, mixFor(heroSeat), []), h.board) : removeDead(new Float64Array(1326).fill(1), h.board);
    if (rangeTotal(heroPerceived) < 1e-6) heroPerceived = removeDead(new Float64Array(1326).fill(1), h.board);
  }
  return { villains: out, heroPerceived };
}
