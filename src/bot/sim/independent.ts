// ============================================================
// Benchmark opponents that share NOTHING with the bot's opponent models.
//
// The archetype policies (policies.ts) draw their actions from the version 1 behaviour model, and
// "range-aware" from the version 2 model, so each engine is tested against players it predicts by
// construction. The policies here are written from first principles and use only:
//   - a hand's raw equity against random hands (Monte Carlo, not the bot's strength features);
//   - pot odds and minimum-defence arithmetic;
//   - their own fixed frequencies.
// None of them calls betProb / responseProbs / the range model. Several are built to punish a player who
// bets too often or too big, which no opponent in the earlier benchmarks did.
//
// They are stand-ins for styles, not models of real people, and none is claimed to be a good strategy.
// Simulator only: nothing here is imported by the extension.
// ============================================================

import { handClass } from '../cards';
import { multiwayEquity } from '../equity/equity';
import { classPercentile, fullRange, toWeighted } from '../ranges/range';
import { ActionInput, HandState, potTotal, seatOf } from '../table/engine';
import { Policy, PolicyView } from './table';

type Choice = Omit<ActionInput, 'seat'>;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const passive = (v: PolicyView): Choice => ({ kind: v.la.canCheck ? 'check' : v.la.canCall ? 'call' : 'fold' });
const giveUp = (v: PolicyView): Choice => ({ kind: v.la.canCheck ? 'check' : 'fold' });
function wager(v: PolicyView, to: number, otherwise: Choice): Choice {
  if (!v.la.canRaise) return otherwise.kind === 'call' && !v.la.canCall ? giveUp(v) : otherwise;
  return { kind: v.la.raiseKind, to: clamp(Math.round(to), v.la.minRaiseTo, v.la.maxRaiseTo) };
}
const betTo = (v: PolicyView, frac: number) => seatOf(v.h, v.seat).streetCommit + frac * potTotal(v.h);
const raiseTo = (v: PolicyView, frac: number) => v.h.currentBet + frac * (potTotal(v.h) + v.la.callAmount);
const liveOpponents = (h: HandState) => Math.max(1, h.seats.filter((s) => s.dealtIn && !s.folded).length - 1);

/** Equity against random hands for up to three live opponents. The only hand-strength measure used here. */
function rawEquity(v: PolicyView, samples: number): number {
  const opp = Math.min(3, liveOpponents(v.h));
  const any = toWeighted(fullRange(), [...v.hole, ...v.h.board]).range;
  return multiwayEquity(v.hole, v.h.board, Array.from({ length: opp }, () => any), samples, v.rng.int(1 << 30)).equity;
}
/** Where equity `eq` stands among random hands with the same number of opponents: 0 = worst, 1 = best (rough, monotone). */
function standing(eq: number, opp: number): number {
  const fair = 1 / (Math.min(3, opp) + 1);
  return eq <= fair ? 0.5 * (eq / fair) : 0.5 + 0.5 * ((eq - fair) / (1 - fair));
}

interface Preflop { open: number; openSize: number; call: number; threeBet: number; fourBet: number; defendBB: number }
/** Own preflop rule: thresholds on the standard hand ranking, a little wider in late position. */
function preflop(v: PolicyView, p: Preflop): Choice {
  const { h, la } = v;
  const me = seatOf(h, v.seat);
  const pct = classPercentile(handClass(v.hole[0], v.hole[1]));
  const late = me.pos!.behindPreflop <= 2 ? 1.35 : me.pos!.behindPreflop <= 4 ? 1 : 0.75;
  if (h.raisesThisStreet === 0) return pct <= p.open * late ? wager(v, p.openSize * h.bigBlind, passive(v)) : pct <= p.call * late || la.canCheck ? passive(v) : { kind: 'fold' };
  if (h.raisesThisStreet === 1) {
    if (pct <= p.threeBet) return wager(v, 3 * h.currentBet, passive(v));
    return pct <= (me.pos!.isBigBlind ? p.defendBB : p.call) ? passive(v) : giveUp(v);
  }
  if (pct <= p.fourBet) return wager(v, la.maxRaiseTo, passive(v));
  return pct <= p.fourBet * 2.5 ? passive(v) : giveUp(v);
}

/**
 * Never folds a hand that has the price, never bluffs. Calls whenever raw equity beats the pot odds (with a
 * small discount for being out of the lead), bets two thirds of the pot only when well ahead.
 */
export function potOddsCallerPolicy(samples = 160): Policy {
  return {
    name: 'pot-odds-caller',
    act(v) {
      if (v.h.street === 'preflop') return preflop(v, { open: 0.14, openSize: 3, call: 0.4, threeBet: 0.03, fourBet: 0.012, defendBB: 0.6 });
      const eq = rawEquity(v, samples);
      const fair = 1 / (Math.min(3, liveOpponents(v.h)) + 1);
      if (v.la.canCheck) return eq > fair + 0.25 ? wager(v, betTo(v, 0.66), { kind: 'check' }) : { kind: 'check' };
      const price = v.la.callAmount / (potTotal(v.h) + v.la.callAmount);
      if (eq > fair + 0.38) return wager(v, raiseTo(v, 0.8), { kind: 'call' });
      return eq * 0.92 >= price ? passive(v) : { kind: 'fold' };
    },
  };
}

/**
 * Defends at the minimum-defence frequency: facing a bet of b into a pot of p it continues with the top
 * p / (p + b) of hands (by standing among random hands) and raises the top slice plus a few of the worst.
 * Bets a polar range when checked to. It cannot be made to fold more often by betting more often.
 */
export function mdfDefenderPolicy(samples = 160): Policy {
  return {
    name: 'mdf-defender',
    act(v) {
      if (v.h.street === 'preflop') return preflop(v, { open: 0.2, openSize: 2.5, call: 0.26, threeBet: 0.06, fourBet: 0.02, defendBB: 0.5 });
      const opp = liveOpponents(v.h);
      const s = standing(rawEquity(v, samples), opp);
      const u = v.rng.next();
      if (v.la.canCheck) {
        if (s > 0.8) return u < 0.75 ? wager(v, betTo(v, 0.7), { kind: 'check' }) : { kind: 'check' };  // some strong hands are checked
        if (s < 0.14 && opp === 1) return u < 0.55 ? wager(v, betTo(v, 0.7), { kind: 'check' }) : { kind: 'check' };
        return { kind: 'check' };
      }
      const b = v.la.callAmount, p = potTotal(v.h) - b;
      const defend = p / (p + b);            // share of hands that must continue
      // Multiway each defender carries a smaller share of the defence.
      const mine = opp > 1 ? 0.7 * defend : defend;
      if (s >= 1 - 0.18 * mine) return wager(v, raiseTo(v, 0.9), { kind: 'call' });
      if (s < 0.05 && opp === 1 && u < 0.5) return wager(v, raiseTo(v, 0.9), { kind: 'fold' });        // bluff raises
      return s >= 1 - mine ? passive(v) : { kind: 'fold' };
    },
  };
}

/**
 * Slow-plays and check-raises. Strong hands are checked and then raised; medium hands call down light.
 * Against a player who bets whenever checked to, this is the style that costs the most.
 */
export function trapperPolicy(samples = 160): Policy {
  return {
    name: 'trapper',
    act(v) {
      if (v.h.street === 'preflop') return preflop(v, { open: 0.15, openSize: 2.5, call: 0.34, threeBet: 0.035, fourBet: 0.012, defendBB: 0.62 });
      const opp = liveOpponents(v.h);
      const s = standing(rawEquity(v, samples), opp);
      const u = v.rng.next();
      if (v.la.canCheck) {
        // Leads only on the river with the best hands; otherwise waits for the opponent to bet.
        if (v.h.street === 'river' && s > 0.86) return wager(v, betTo(v, 0.8), { kind: 'check' });
        return s > 0.55 && s < 0.8 && u < 0.3 ? wager(v, betTo(v, 0.4), { kind: 'check' }) : { kind: 'check' };
      }
      const price = v.la.callAmount / (potTotal(v.h) + v.la.callAmount);
      if (s > 0.84) return u < (v.h.street === 'river' ? 0.9 : 0.65) ? wager(v, raiseTo(v, 1), { kind: 'call' }) : { kind: 'call' };
      if (s < 0.1 && opp === 1 && u < 0.3) return wager(v, raiseTo(v, 1), { kind: 'fold' });
      return s >= 0.32 + 0.5 * price ? passive(v) : { kind: 'fold' };
    },
  };
}

/** Bets and raises very often, with any hand. Tests whether the bot pays off too little or folds too much. */
export function maniacPolicy(samples = 120): Policy {
  return {
    name: 'maniac',
    act(v) {
      if (v.h.street === 'preflop') return preflop(v, { open: 0.5, openSize: 3.5, call: 0.7, threeBet: 0.18, fourBet: 0.05, defendBB: 0.85 });
      const u = v.rng.next();
      if (v.la.canCheck) return u < 0.72 ? wager(v, betTo(v, 0.6 + 0.6 * v.rng.next()), { kind: 'check' }) : { kind: 'check' };
      const s = standing(rawEquity(v, samples), liveOpponents(v.h));
      if (u < 0.22 || s > 0.85) return wager(v, raiseTo(v, 1), { kind: 'call' });
      return s > 0.3 ? passive(v) : { kind: 'fold' };
    },
  };
}

/** Plays few hands and continues only when clearly ahead; folds everything else to any bet. */
export function nitPolicy(samples = 160): Policy {
  return {
    name: 'nit',
    act(v) {
      if (v.h.street === 'preflop') return preflop(v, { open: 0.09, openSize: 3, call: 0.1, threeBet: 0.025, fourBet: 0.01, defendBB: 0.2 });
      const s = standing(rawEquity(v, samples), liveOpponents(v.h));
      if (v.la.canCheck) return s > 0.78 ? wager(v, betTo(v, 0.75), { kind: 'check' }) : { kind: 'check' };
      return s > 0.9 ? wager(v, raiseTo(v, 0.8), { kind: 'call' }) : s > 0.72 ? passive(v) : { kind: 'fold' };
    },
  };
}

/**
 * Counts how often the other players bet when they could have checked, and adjusts: the more they bet, the
 * lighter it calls and the more often it raises. Starts as a plain pot-odds player and needs a few dozen
 * hands to move. This is the opponent "capable of exploiting excessive betting" in the literal sense.
 */
export function adaptivePunisherPolicy(samples = 160): Policy {
  let chances = 0, bets = 0, hand = '', mySeat = -1;
  return {
    name: 'adaptive-punisher',
    act(v) {
      hand = v.h.handId; mySeat = v.seat;
      if (v.h.street === 'preflop') return preflop(v, { open: 0.17, openSize: 2.5, call: 0.3, threeBet: 0.05, fourBet: 0.015, defendBB: 0.55 });
      const opp = liveOpponents(v.h);
      const s = standing(rawEquity(v, samples), opp);
      // Observed betting frequency of the others, shrunk toward 40% until there is evidence.
      const freq = (bets + 0.4 * 30) / (chances + 30);
      const excess = clamp((freq - 0.4) / 0.3, -0.5, 1);       // +1: they bet about 70% of the time
      const u = v.rng.next();
      if (v.la.canCheck) {
        // Against frequent bettors, check good hands to them instead of betting.
        const lead = s > 0.75 ? 0.8 - 0.6 * Math.max(0, excess) : 0;
        return u < lead ? wager(v, betTo(v, 0.66), { kind: 'check' }) : { kind: 'check' };
      }
      const price = v.la.callAmount / (potTotal(v.h) + v.la.callAmount);
      const raiseValue = 0.86 - 0.08 * Math.max(0, excess);
      if (s > raiseValue) return wager(v, raiseTo(v, 1), { kind: 'call' });
      if (opp === 1 && s < 0.3 && u < 0.22 * Math.max(0, excess)) return wager(v, raiseTo(v, 1), { kind: 'fold' });
      return s >= 0.3 + 0.55 * price - 0.14 * excess ? passive(v) : { kind: 'fold' };
    },
    observe(h) {
      // Postflop: every action taken when a check was possible is a chance to bet.
      const byStreet = new Map<string, number>();
      for (const e of h.events) {
        if (e.street === 'preflop' || e.kind.startsWith('post')) continue;
        const own = h.handId === hand && e.seat === mySeat;
        const open = (byStreet.get(e.street) ?? 0) === 0;       // nobody has bet yet on this street
        if (open && !own && (e.kind === 'check' || e.kind === 'bet')) { chances++; if (e.kind === 'bet') bets++; }
        if (e.kind === 'bet' || e.kind === 'raise') byStreet.set(e.street, 1);
      }
    },
  };
}

/**
 * Raises bets a lot: with its best hands for value and with some of its weakest as bluffs, and checks back
 * middling hands. Tests whether a bettor folds too much to raises or pays them off too lightly.
 */
export function raiserPolicy(samples = 160): Policy {
  return {
    name: 'raiser',
    act(v) {
      if (v.h.street === 'preflop') return preflop(v, { open: 0.22, openSize: 3, call: 0.3, threeBet: 0.09, fourBet: 0.025, defendBB: 0.55 });
      const opp = liveOpponents(v.h);
      const s = standing(rawEquity(v, samples), opp);
      const u = v.rng.next();
      if (v.la.canCheck) return (s > 0.78 && u < 0.7) || (s < 0.2 && u < 0.35) ? wager(v, betTo(v, 0.6), { kind: 'check' }) : { kind: 'check' };
      const price = v.la.callAmount / (potTotal(v.h) + v.la.callAmount);
      if (s > 0.72 || (opp === 1 && s < 0.25 && u < 0.3)) return wager(v, raiseTo(v, 1), s > 0.72 ? { kind: 'call' } : { kind: 'fold' });
      return s >= 0.35 + 0.5 * price ? passive(v) : { kind: 'fold' };
    },
  };
}

export const INDEPENDENT_FACTORIES: Record<string, () => Policy> = {
  raiser: () => raiserPolicy(),
  'pot-odds-caller': () => potOddsCallerPolicy(),
  'mdf-defender': () => mdfDefenderPolicy(),
  trapper: () => trapperPolicy(),
  maniac: () => maniacPolicy(),
  nit: () => nitPolicy(),
  'adaptive-punisher': () => adaptivePunisherPolicy(),
};
