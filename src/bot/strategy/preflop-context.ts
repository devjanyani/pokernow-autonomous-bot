// ============================================================
// Preflop decision classification (Phase 3.1).
//
// One pure function, classifyPreflop(h, heroSeat), reads the rules engine's state and says exactly which preflop
// decision Hero faces, with everything a strategy needs to look up or compute it. It decides nothing.
//
// Four counts are kept apart on purpose:
//   seats         seats at the table (h.tableSeats), occupied or not
//   seated        players sitting at the table this hand (sitting-out players included, not dealt in)
//   dealtIn       players dealt into this hand (positions are assigned among these only)
//   inPot         dealt-in players who have not folded (all-in players included)
//   canAct        in the pot and not all-in (can still make a betting decision)
// and "behind" is always about the CURRENT hand's action order, never physical seat numbers.
//
// Situations (Hero's perspective, at the moment Hero is to act preflop):
//   unopened              nobody has entered voluntarily; Hero (not the big blind) may open, limp or fold
//   limped-bb-option      big blind after one or more limps and no raise: check or raise
//   facing-limpers        one or more limps, no raise, Hero is not the big blind
//   facing-open           one raise, nobody called it before Hero, Hero has not entered voluntarily
//   facing-open-callers   one raise with one or more callers before Hero: the squeeze opportunity
//   facing-iso            Hero limped (or over-limped) and faces a raise
//   facing-3bet           Hero made the first raise and faces a re-raise with no caller in between
//   facing-squeeze        Hero opened and faces a re-raise with a caller before it or after it (multiway 3-bet pot),
//                         or Hero flat-called the open and faces a re-raise (Hero is a caller, not the opener)
//   cold-facing-3bet      Hero has not entered: a raise and a re-raise before Hero (cold 4-bet spot)
//   facing-4bet           Hero made the 3-bet and faces a 4-bet
//   facing-5bet-plus      Hero made a 4-bet or more and faces a further raise
//   cold-facing-4bet-plus Hero has not raised and faces three or more raises
// Flags on top: facingAllIn (the last raise is all-in or the call is at least 40% of Hero's stack, as decidePreflop's
// commitment rule), shortStack (effective stack <= 16bb, decidePreflop's short-stack branches), blindDefense (Hero
// is a blind facing exactly one raise and has not entered voluntarily).
// ============================================================

import { effectiveStack, HandState, legalActions, seatOf, SeatState } from '../table/engine';

export type PreflopSituation =
  | 'unopened' | 'limped-bb-option' | 'facing-limpers' | 'facing-open' | 'facing-open-callers' | 'facing-iso'
  | 'facing-3bet' | 'facing-squeeze' | 'cold-facing-3bet' | 'facing-4bet' | 'facing-5bet-plus' | 'cold-facing-4bet-plus';

export const PREFLOP_SITUATIONS: readonly PreflopSituation[] = [
  'unopened', 'limped-bb-option', 'facing-limpers', 'facing-open', 'facing-open-callers', 'facing-iso',
  'facing-3bet', 'facing-squeeze', 'cold-facing-3bet', 'facing-4bet', 'facing-5bet-plus', 'cold-facing-4bet-plus',
];

export interface PreflopStep {
  seat: number;
  position: string;
  kind: 'fold' | 'check' | 'call' | 'raise';
  /** Street commitment after the action, in big blinds. */
  toBB: number;
  allIn: boolean;
}

export interface PreflopContext {
  situation: PreflopSituation;
  facingAllIn: boolean;
  shortStack: boolean;
  blindDefense: boolean;
  counts: { seats: number; seated: number; dealtIn: number; inPot: number; canAct: number };
  headsUpTable: boolean;
  hero: { seat: number; position: string; group: 'early' | 'middle' | 'late' | 'blinds'; behindPreflop: number; chart6: string | null; isButton: boolean; isSmallBlind: boolean; isBigBlind: boolean };
  /** Players who still have to act after Hero in this betting round, in order (in the pot, not all-in). */
  toActAfterHero: number;
  /** Players after Hero in preflop order who have not acted yet at all this hand (the unopened-pot "behind"). */
  unactedBehind: number;
  limpers: number;
  /** Number of raises so far (the blinds and a straddle are not raises). */
  raises: number;
  /** Hero's own raise level: 0 none, 1 first raise, 2 the 3-bet, ... (the latest one Hero made). */
  heroRaiseLevel: number;
  heroLimped: boolean;
  heroCalledRaise: boolean;
  /** Callers since the last raise, before Hero. */
  callersSinceLastRaise: number;
  /** Callers between the previous raise and the last raise (a squeeze: Hero opened, somebody called, a 3-bet came). */
  callersBeforeLastRaise: number;
  /** First raiser and last raiser (null when there is none). */
  opener: { seat: number; position: string; behindPreflop: number; toBB: number; overLimpers: number } | null;
  lastRaiser: { seat: number; position: string; behindPreflop: number; toBB: number; multipleOfPrevious: number; allIn: boolean } | null;
  /** Amount Hero must add to call, in big blinds; 0 when Hero may check. */
  toCallBB: number;
  potBB: number;
  /** Effective stack (Hero against the deepest player still in the pot), in big blinds, at the start of this decision. */
  effectiveStackBB: number;
  heroStackBB: number;
  anteBB: number;
  straddleBB: number;
  deadSmallBlind: boolean;
  /** Voluntary preflop actions so far, in order. */
  sequence: PreflopStep[];
}

const SHORT_BB = 16;

export function positionGroup(p: NonNullable<SeatState['pos']>): 'early' | 'middle' | 'late' | 'blinds' {
  if (p.isSmallBlind || p.isBigBlind) return p.isButton ? 'late' : 'blinds';
  if (p.isButton || p.label === 'CO') return 'late';
  if (p.label.startsWith('UTG')) return 'early';
  return 'middle';
}

/** Classify the preflop decision Hero faces. Throws when it is not Hero's turn preflop. */
export function classifyPreflop(h: HandState, heroSeat: number): PreflopContext {
  if (h.street !== 'preflop') throw new Error('classifyPreflop: not preflop');
  const la = legalActions(h, heroSeat);
  if (!la) throw new Error('classifyPreflop: Hero is not to act');
  const bb = h.bigBlind;
  const hero = seatOf(h, heroSeat);
  const hp = hero.pos!;
  const dealt = h.seats.filter((s) => s.dealtIn);
  const sequence: PreflopStep[] = [];
  let raises = 0, limpers = 0, callersSince = 0, callersBefore = 0, heroRaiseLevel = 0, heroLimped = false, heroCalledRaise = false;
  let opener: PreflopContext['opener'] = null, lastRaiser: PreflopContext['lastRaiser'] = null;
  let lastRaiseTo = h.straddle > 0 ? h.straddle : bb;
  const acted = new Set<number>();
  for (const e of h.events) {
    if (e.street !== 'preflop' || e.kind.startsWith('post')) continue;
    const s = seatOf(h, e.seat);
    acted.add(e.seat);
    sequence.push({ seat: e.seat, position: s.pos!.label, kind: e.kind as PreflopStep['kind'], toBB: e.to / bb, allIn: e.allIn });
    if (e.kind === 'raise') {
      raises++;
      const mult = e.to / Math.max(1e-9, lastRaiseTo);
      if (!opener) opener = { seat: e.seat, position: s.pos!.label, behindPreflop: s.pos!.behindPreflop, toBB: e.to / bb, overLimpers: limpers };
      lastRaiser = { seat: e.seat, position: s.pos!.label, behindPreflop: s.pos!.behindPreflop, toBB: e.to / bb, multipleOfPrevious: mult, allIn: e.allIn };
      lastRaiseTo = e.to;
      callersBefore = raises >= 2 ? callersSince : 0;
      callersSince = 0;
      if (e.seat === heroSeat) heroRaiseLevel = raises;
    } else if (e.kind === 'call') {
      if (raises === 0) { limpers++; if (e.seat === heroSeat) heroLimped = true; }
      else { callersSince++; if (e.seat === heroSeat) heroCalledRaise = true; }
    }
  }
  const inPot = dealt.filter((s) => !s.folded);
  const myOrder = hp.preflopOrder;
  const after = inPot.filter((s) => s.seat !== heroSeat && !s.allIn);
  // Who still acts after Hero in this round if Hero just calls: everyone in the pot with chips who has not acted
  // yet, or has acted but not matched the current bet (a raise by Hero would add the others as well).
  const toActAfterHero = after.filter((s) => !acted.has(s.seat) || s.streetCommit < h.currentBet - 1e-9).length;
  const unactedBehind = after.filter((s) => s.pos!.preflopOrder > myOrder && !acted.has(s.seat)).length;

  let situation: PreflopSituation;
  if (raises === 0) situation = limpers === 0 ? 'unopened' : hp.isBigBlind && la.canCheck ? 'limped-bb-option' : 'facing-limpers';
  else if (heroLimped && heroRaiseLevel === 0) situation = 'facing-iso';
  else if (raises === 1) situation = callersSince > 0 ? 'facing-open-callers' : 'facing-open';
  else if (raises === 2) {
    if (heroRaiseLevel === 1) situation = callersBefore > 0 || callersSince > 0 ? 'facing-squeeze' : 'facing-3bet';
    else if (heroCalledRaise) situation = 'facing-squeeze';
    else situation = 'cold-facing-3bet';
  } else if (heroRaiseLevel === raises - 1 && heroRaiseLevel >= 2) situation = heroRaiseLevel === 2 ? 'facing-4bet' : 'facing-5bet-plus';
  else if (heroRaiseLevel >= 2) situation = 'facing-5bet-plus';
  else situation = 'cold-facing-4bet-plus';

  const heroStackBB = hero.stack / bb;
  const effBB = effectiveStack(h, heroSeat) / bb;
  const toCallBB = la.callAmount / bb;
  const facingAllIn = raises >= 1 && toCallBB > 0 && ((lastRaiser?.allIn ?? false) || la.callAmount >= 0.4 * hero.stack);
  const potBB = h.seats.reduce((t, s) => t + s.totalCommit, 0) / bb;
  return {
    situation, facingAllIn, shortStack: effBB <= SHORT_BB,
    blindDefense: (hp.isSmallBlind || hp.isBigBlind) && raises === 1 && !heroLimped && heroRaiseLevel === 0 && !heroCalledRaise,
    counts: { seats: h.tableSeats, seated: h.seats.length, dealtIn: dealt.length, inPot: inPot.length, canAct: inPot.filter((s) => !s.allIn).length },
    headsUpTable: dealt.length === 2,
    hero: { seat: heroSeat, position: hp.label, group: positionGroup(hp), behindPreflop: hp.behindPreflop, chart6: hp.chart6, isButton: hp.isButton, isSmallBlind: hp.isSmallBlind, isBigBlind: hp.isBigBlind },
    toActAfterHero, unactedBehind, limpers, raises, heroRaiseLevel, heroLimped, heroCalledRaise, callersSinceLastRaise: callersSince, callersBeforeLastRaise: callersBefore,
    opener, lastRaiser, toCallBB, potBB, effectiveStackBB: effBB, heroStackBB, anteBB: h.ante / bb, straddleBB: h.straddle / bb,
    deadSmallBlind: dealt.length > 2 && !dealt.some((s) => s.pos!.isSmallBlind),
    sequence,
  };
}

/** One line for explanations and reports, e.g. "facing-open from CO (2.5bb) at 9 dealt in, 100bb, 2 to act after". */
export function describePreflopContext(c: PreflopContext): string {
  const flags = [c.facingAllIn ? 'facing all-in' : '', c.shortStack ? 'short stack' : '', c.blindDefense ? 'blind defence' : ''].filter(Boolean).join(', ');
  const vs = c.lastRaiser ? ` from ${c.lastRaiser.position} (to ${c.lastRaiser.toBB.toFixed(1)}bb${c.raises > 1 ? `, ×${c.lastRaiser.multipleOfPrevious.toFixed(1)}` : ''})` : c.limpers ? ` (${c.limpers} limper${c.limpers > 1 ? 's' : ''})` : '';
  return `${c.situation}${vs}; Hero ${c.hero.position} (${c.hero.behindPreflop} behind in an unopened pot) at ${c.counts.dealtIn} dealt in, effective ${c.effectiveStackBB.toFixed(0)}bb, ${c.toActAfterHero} still to act after Hero${flags ? `; ${flags}` : ''}`;
}
