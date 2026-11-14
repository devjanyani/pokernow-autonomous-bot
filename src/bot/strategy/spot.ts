// ============================================================
// Spot analysis: who raised last before the flop, who holds the betting lead on
// this street, where Hero sits relative to the opponents, the pot type, the
// stack-to-pot ratio, and what a bet by Hero would be called (continuation bet,
// lead / donk bet, probe, delayed continuation bet).
//
// Everything here is read from the reconstructed action sequence, i.e. what
// actually happened in the hand, including actions Hero took against the
// engine's advice. Nothing is looked up by "the line Hero should have taken".
// ============================================================

import { CardId, comboIndex } from '../cards';
import { bandsForLine, preflopLine } from '../ranges/preflop-model';
import type { BetRole } from '../ranges/postflop-model';
import { rangeFromBands } from '../ranges/range';
import { HandState, potTotal, seatOf, Street, STREETS } from '../table/engine';

export type HeroBetType = 'continuation bet' | 'lead (donk bet)' | 'probe bet' | 'delayed continuation bet' | 'bet (no aggressor)' | 'raise';

export interface SpotInfo {
  street: Street;
  /** Seat of the last preflop raiser, null in a limped pot. */
  preflopAggressor: number | null;
  /** Seat that made the last bet or raise on the street before this one (null: none, or that player folded). */
  leadSeat: number | null;
  /** Hero's own betting lead if it bets first now. */
  heroRole: BetRole;
  heroIsPreflopAggressor: boolean;
  /** 'in position' = Hero acts after every opponent still in the hand, 'out of position' = before all of them. */
  position: 'in position' | 'out of position' | 'in between';
  potType: 'limped' | 'single-raised' | '3-bet' | '4-bet or more';
  opponents: number;
  /** Effective stack divided by the pot. */
  spr: number;
  /** Name of a bet or raise made by Hero right now. */
  heroBetType: HeroBetType;
  /** Weight (0..1) of Hero's actual hand in the range the opponent model would give Hero's own preflop line. */
  heroLineWeight: number;
  /** Hero's own preflop line as the model classifies it (limp, call-open, open, ...). */
  heroLine: string;
  /** True when Hero's hand is essentially absent from that range (Hero deviated from the preflop advice, or the range model is too narrow). */
  offRange: boolean;
}

const prevStreet = (s: Street): Street | null => { const i = STREETS.indexOf(s); return i > 0 ? STREETS[i - 1] : null; };

/**
 * The player holding the lead at the start of `street`: the last bettor or raiser of the street
 * immediately before it, if still in the hand. A street that was checked through passes no lead on.
 */
export function leadSeatFor(h: HandState, street: Street): number | null {
  const p = prevStreet(street);
  if (!p) return null;
  const seat = h.aggressor[p];
  if (seat === null) return null;
  const s = h.seats.find((x) => x.seat === seat);
  return s && !s.folded ? seat : null;
}

/**
 * Lead of `seat` if it bets first on the current street, given who has already acted.
 * @param acted seats that have already acted on this street
 */
export function betRole(h: HandState, seat: number, lead: number | null, acted: ReadonlySet<number>): BetRole {
  if (lead === null) return 'neutral';
  if (seat === lead) return 'aggressor';
  const l = h.seats.find((x) => x.seat === lead);
  if (!l || l.folded || l.allIn || acted.has(lead)) return 'neutral';
  return 'into-aggressor';
}

export function analyseSpot(h: HandState, heroSeat: number, heroCards: [CardId, CardId]): SpotInfo {
  const hero = seatOf(h, heroSeat);
  const live = h.seats.filter((s) => s.dealtIn && !s.folded && s.seat !== heroSeat);
  let raises = 0, preflopAggressor: number | null = null;
  for (const e of h.events) if (e.street === 'preflop' && e.kind === 'raise') { raises++; preflopAggressor = e.seat; }
  const lead = leadSeatFor(h, h.street);
  const acted = new Set(h.events.filter((e) => e.street === h.street && !e.kind.startsWith('post')).map((e) => e.seat));
  const heroRole = betRole(h, heroSeat, lead, acted);
  const key = h.street === 'preflop' ? 'preflopOrder' : 'postflopOrder';
  const after = live.filter((s) => s.pos![key] > hero.pos![key]).length;
  const position: SpotInfo['position'] = live.length === 0 || after === 0 ? 'in position' : after === live.length ? 'out of position' : 'in between';
  const pot = potTotal(h);
  const eff = Math.min(hero.stack, Math.max(0, ...live.map((s) => s.stack)));

  const facing = h.currentBet > hero.streetCommit;
  let heroBetType: HeroBetType;
  if (facing) heroBetType = 'raise';
  else if (heroRole === 'aggressor') heroBetType = 'continuation bet';
  else if (heroRole === 'into-aggressor') heroBetType = 'lead (donk bet)';
  else if (lead !== null) heroBetType = 'probe bet';                         // the aggressor checked this street
  else {
    // Nobody bet the previous street. If Hero was the aggressor two streets back it is a delayed continuation bet.
    const p = prevStreet(h.street), pp = p ? prevStreet(p) : null;
    const earlier = pp ? h.aggressor[pp] : null;
    heroBetType = earlier === heroSeat ? 'delayed continuation bet' : earlier !== null && h.street !== 'preflop' ? 'probe bet' : 'bet (no aggressor)';
  }

  const line = preflopLine(h, heroSeat);
  const w = line.kind === 'unacted' || line.kind === 'bb-check' ? 1 : rangeFromBands(bandsForLine(line))[comboIndex(heroCards[0], heroCards[1])];
  return {
    street: h.street, preflopAggressor, leadSeat: lead, heroRole, heroIsPreflopAggressor: preflopAggressor === heroSeat, position,
    potType: raises === 0 ? 'limped' : raises === 1 ? 'single-raised' : raises === 2 ? '3-bet' : '4-bet or more',
    opponents: live.length, spr: eff / Math.max(1, pot), heroBetType, heroLineWeight: w, heroLine: line.kind, offRange: w < 0.05,
  };
}

/** One-line description for the decision explanation. */
export function describeSpot(s: SpotInfo, nameOf: (seat: number) => string): string {
  const agg = s.preflopAggressor === null ? (s.street === 'preflop' ? 'no raise so far' : 'limped pot (no preflop raiser)')
    : s.heroIsPreflopAggressor ? `${s.potType} pot, Hero was the last preflop raiser`
      : `${s.potType} pot, last preflop raiser ${nameOf(s.preflopAggressor)}`;
  const lead = s.street === 'preflop' ? '' : s.leadSeat === null ? '; nobody holds the betting lead'
    : s.heroRole === 'aggressor' ? '; Hero holds the betting lead' : `; ${nameOf(s.leadSeat)} holds the betting lead`;
  if (s.street === 'preflop') return `${agg}; ${s.opponents} opponent(s) still in the hand`;
  return `${agg}${lead}; Hero is ${s.position} against ${s.opponents} opponent(s); stack-to-pot ${s.spr.toFixed(1)}`;
}
