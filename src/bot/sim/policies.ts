// ============================================================
// Benchmark opponents for the offline simulator.
//
//   random            uniformly random legal action
//   calling-station   fixed strategy: never folds, never raises
//   tight-passive     \
//   loose-passive      | "archetype" players: preflop by hand percentile,
//   tight-aggressive   | postflop by the behaviour model in
//   loose-aggressive  /  ranges/postflop-model.ts with fixed tendencies
//   range-equity      out-of-family benchmark: acts on Monte Carlo equity
//                     versus random hands compared with fixed thresholds
//   range-aware       plays the version 2 behaviour model directly: strength measured inside
//                     its own range and against the others' ranges, bets most with the
//                     betting lead and rarely into it (same family as the v2 bot's
//                     opponent model, so results against it flatter v2 the way the four
//                     archetypes flatter v1)
//   deviating-*       wraps a bot and, like a user ignoring advice, calls a cheap preflop
//                     bet half the time the bot says fold; postflop the bot decides
//   bot               the BotAgent under test
//
// NOTE ON BIAS: the four archetypes are drawn from the same model family the
// bot uses to predict opponents, so results against them are optimistic.
// `range-equity`, `random`, `calling-station` and the legacy engine seat
// (sim/bot/legacy-seat.ts) are not.
// ============================================================

import { comboIndex, handClass } from '../cards';
import { BotAgent, AgentOptions } from '../agent';
import { multiwayEquity } from '../equity/equity';
import { betProb, responseProbs, Tendencies } from '../ranges/postflop-model';
import { openFraction } from '../ranges/preflop-model';
import { classPercentile, fullRange, toWeighted } from '../ranges/range';
import { buildTable, FeatureCache } from '../strategy/villains';
import { betProb2, mixRanges, responseProbs2, strengthTable } from '../ranges/range-model';
import { NEUTRAL } from '../ranges/postflop-model';
import { betRole, leadSeatFor } from '../strategy/spot';
import { ActionInput, potTotal, seatOf } from '../table/engine';
import type { Decision } from '../strategy/types';
import { Policy, PolicyView } from './table';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
type Choice = Omit<ActionInput, 'seat'>;

function raiseOr(view: PolicyView, to: number, fallback: 'call' | 'check' | 'fold'): Choice {
  const { la } = view;
  if (!la.canRaise) return { kind: fallback === 'call' && !la.canCall ? (la.canCheck ? 'check' : 'fold') : fallback };
  return { kind: la.raiseKind, to: clamp(Math.round(to), la.minRaiseTo, la.maxRaiseTo) };
}
const passive = (view: PolicyView): Choice => ({ kind: view.la.canCheck ? 'check' : view.la.canCall ? 'call' : 'fold' });
const giveUp = (view: PolicyView): Choice => ({ kind: view.la.canCheck ? 'check' : 'fold' });

export function randomPolicy(): Policy {
  return {
    name: 'random',
    act(view) {
      const { la, rng } = view;
      const opts: Choice[] = [];
      if (la.canCheck) opts.push({ kind: 'check' }); else opts.push({ kind: 'fold' });
      if (la.canCall) opts.push({ kind: 'call' });
      if (la.canRaise) opts.push({ kind: la.raiseKind, to: la.minRaiseTo + Math.floor(rng.next() * (la.maxRaiseTo - la.minRaiseTo + 1)) });
      return opts[rng.int(opts.length)];
    },
  };
}

export function callingStationPolicy(): Policy {
  return { name: 'calling-station', act: passive };
}

export interface ArchetypeParams { name: string; tend: Tendencies; threeBet: number; baseVpip: number; basePfr: number }

export const ARCHETYPES: Record<string, ArchetypeParams> = {
  'tight-passive': { name: 'tight-passive', tend: { looseness: 0.65, preflopAggression: 0.4, aggression: -0.8, stickiness: -0.3 }, threeBet: 0.02, baseVpip: 0.16, basePfr: 0.06 },
  'loose-passive': { name: 'loose-passive', tend: { looseness: 1.9, preflopAggression: 0.4, aggression: -0.7, stickiness: 0.9 }, threeBet: 0.02, baseVpip: 0.48, basePfr: 0.07 },
  'tight-aggressive': { name: 'tight-aggressive', tend: { looseness: 0.85, preflopAggression: 1, aggression: 0.3, stickiness: 0 }, threeBet: 0.06, baseVpip: 0.22, basePfr: 0.17 },
  'loose-aggressive': { name: 'loose-aggressive', tend: { looseness: 1.5, preflopAggression: 1.6, aggression: 0.9, stickiness: 0.2 }, threeBet: 0.11, baseVpip: 0.38, basePfr: 0.28 },
};

export function archetypePolicy(key: keyof typeof ARCHETYPES | ArchetypeParams): Policy {
  const p = typeof key === 'string' ? ARCHETYPES[key] : key;
  const cache = new FeatureCache();
  return {
    name: p.name,
    act(view) {
      const { h, seat, hole, la, rng } = view;
      const me = seatOf(h, seat);
      const pot = potTotal(h);
      if (h.street === 'preflop') {
        const pct = classPercentile(handClass(hole[0], hole[1]));
        const hu = h.seats.filter((s) => s.dealtIn).length === 2;
        // Position scaling: later positions play proportionally more hands.
        const posScale = openFraction(me.pos!.behindPreflop, hu) / 0.22;
        const raises = h.raisesThisStreet;
        if (raises === 0) {
          if (pct <= p.basePfr * posScale) return raiseOr(view, h.currentBet * 2.5 + (pot - 1.5 * h.bigBlind), 'call');
          if (pct <= p.baseVpip * posScale) return passive(view);
          return giveUp(view);
        }
        const price = la.callAmount / Math.max(1, pot + la.callAmount);
        if (raises === 1) {
          if (pct <= p.threeBet) return raiseOr(view, h.currentBet * 3, 'call');
          const defend = p.baseVpip * (me.pos!.isBigBlind ? 1.1 : 0.55) * (price < 0.25 ? 1.3 : 1);
          return pct <= defend ? passive(view) : giveUp(view);
        }
        if (pct <= 0.012) return raiseOr(view, la.maxRaiseTo, 'call');
        if (pct <= 0.02 + 0.04 * p.tend.stickiness + (price < 0.3 ? 0.03 : 0)) return passive(view);
        return giveUp(view);
      }
      const f = cache.get(h.board);
      const es = f.es[comboIndex(hole[0], hole[1])];
      const opponents = Math.max(1, h.seats.filter((s) => s.dealtIn && !s.folded).length - 1);
      const u = rng.next();
      if (la.canCheck) {
        const frac = 0.33 + 0.67 * rng.next();
        const pb = betProb(es, { street: h.street, betFrac: frac, opponents, isRaise: false, tend: p.tend });
        return u < pb ? raiseOr(view, me.streetCommit + frac * pot, 'check') : { kind: 'check' };
      }
      const betFrac = la.callAmount / Math.max(1, pot - la.callAmount);
      const r = responseProbs(es, { street: h.street, betFrac, opponents, isRaise: h.raisesThisStreet >= 2, tend: p.tend });
      if (u < r.fold) return { kind: 'fold' };
      if (u < r.fold + r.call) return passive(view);
      return raiseOr(view, h.currentBet + 0.8 * (pot + la.callAmount), 'call');
    },
  };
}

/** Out-of-family benchmark: thresholds on equity versus random hands for every live opponent. */
export function rangeEquityPolicy(samples = 250): Policy {
  return {
    name: 'range-equity',
    act(view) {
      const { h, seat, hole, la, rng } = view;
      const me = seatOf(h, seat);
      const pot = potTotal(h);
      const opp = Math.max(1, h.seats.filter((s) => s.dealtIn && !s.folded).length - 1);
      if (h.street === 'preflop') {
        const pct = classPercentile(handClass(hole[0], hole[1]));
        const raises = h.raisesThisStreet;
        if (raises === 0) return pct < 0.16 ? raiseOr(view, 3 * h.bigBlind, 'call') : pct < 0.3 && me.pos!.behindPreflop <= 3 ? passive(view) : giveUp(view);
        if (raises === 1) return pct < 0.045 ? raiseOr(view, 3 * h.currentBet, 'call') : pct < 0.14 ? passive(view) : giveUp(view);
        return pct < 0.012 ? raiseOr(view, la.maxRaiseTo, 'call') : pct < 0.03 ? passive(view) : giveUp(view);
      }
      const dead = [...hole, ...h.board];
      const any = toWeighted(fullRange(), dead).range;
      const eq = multiwayEquity(hole, h.board, Array.from({ length: Math.min(opp, 3) }, () => any), samples, rng.int(1 << 30)).equity;
      const fair = 1 / (Math.min(opp, 3) + 1);
      if (la.canCheck) return eq > fair + 0.22 ? raiseOr(view, me.streetCommit + 0.66 * pot, 'check') : { kind: 'check' };
      const price = la.callAmount / Math.max(1, pot + la.callAmount);
      if (eq > fair + 0.35) return raiseOr(view, h.currentBet + 0.8 * (pot + la.callAmount), 'call');
      return eq > Math.max(price + 0.12, fair + 0.08) ? passive(view) : { kind: 'fold' };
    },
  };
}

/** Plays the version 2 range-aware behaviour model directly (preflop: the tight-aggressive archetype). */
export function rangeAwarePolicy(tend: Tendencies = NEUTRAL, name = 'range-aware'): Policy {
  const cache = new FeatureCache();
  const pre = archetypePolicy('tight-aggressive');
  const none = new Map<string, never>();
  return {
    name,
    act(view) {
      const { h, seat, hole, la, rng } = view;
      if (h.street === 'preflop') return pre.act(view) as Choice;
      const me = seatOf(h, seat);
      const pot = potTotal(h);
      const t = buildTable(h, seat, hole, none, 0, cache);
      const f = cache.get(h.board);
      const s = strengthTable(t.heroPerceived, mixRanges(t.villains.map((v) => v.range)), f)[comboIndex(hole[0], hole[1])];
      const opponents = Math.max(1, t.villains.length);
      const u = rng.next();
      if (la.canCheck) {
        const acted = new Set(h.events.filter((e) => e.street === h.street && !e.kind.startsWith('post')).map((e) => e.seat));
        const role = betRole(h, seat, leadSeatFor(h, h.street), acted);
        const frac = 0.33 + 0.67 * rng.next();
        return u < betProb2(s, { street: h.street, betFrac: frac, opponents, isRaise: false, tend, role }) ? raiseOr(view, me.streetCommit + frac * pot, 'check') : { kind: 'check' };
      }
      const betFrac = la.callAmount / Math.max(1, pot - la.callAmount);
      const r = responseProbs2(s, { street: h.street, betFrac, opponents, isRaise: h.raisesThisStreet >= 2, tend });
      if (u < r.fold) return { kind: 'fold' };
      if (u < r.fold + r.call) return passive(view);
      return raiseOr(view, h.currentBet + 0.8 * (pot + la.callAmount), 'call');
    },
  };
}

/**
 * A user who ignores preflop advice: when the wrapped bot says fold and calling costs at most `maxCallBB`
 * big blinds, call instead with probability `rate`. Everything else is the bot's own decision, so the bot
 * regularly finds itself after the flop with hands outside the range of its line.
 */
export function deviatingPolicy(inner: BotPolicy, rate = 0.5, maxCallBB = 5): Policy {
  return {
    name: `deviating-${inner.name}`,
    act(view) {
      const choice = inner.act(view) as Choice;
      const { h, la, rng } = view;
      if (h.street === 'preflop' && choice.kind === 'fold' && la.canCall && la.callAmount <= maxCallBB * h.bigBlind && rng.fork(991).next() < rate) return { kind: 'call' };
      return choice;
    },
    observe: inner.observe,
  };
}

export interface BotPolicy extends Policy { agent: BotAgent; decisions: Decision[]; keepDecisions: boolean }

/** The bot under test. `samples` fixes the Monte Carlo budget so runs are reproducible. */
export function botPolicy(opts: AgentOptions & { samples?: number; name?: string; observe?: boolean } = {}): BotPolicy {
  const agent = new BotAgent(opts);
  const samples = opts.samples ?? 400;
  const p: BotPolicy = {
    name: opts.name ?? 'bot', agent, decisions: [], keepDecisions: false,
    act(view) {
      const d = agent.decideSync(view.h, view.seat, view.hole, samples);
      if (p.keepDecisions) p.decisions.push(d);
      return { kind: d.action, to: d.to };
    },
    observe(h, reveals) { if (opts.observe !== false) agent.observeHand(h, reveals); },
  };
  return p;
}

export const POLICY_FACTORIES: Record<string, () => Policy> = {
  random: randomPolicy,
  'calling-station': callingStationPolicy,
  'tight-passive': () => archetypePolicy('tight-passive'),
  'loose-passive': () => archetypePolicy('loose-passive'),
  'tight-aggressive': () => archetypePolicy('tight-aggressive'),
  'loose-aggressive': () => archetypePolicy('loose-aggressive'),
  'range-equity': () => rangeEquityPolicy(),
  'range-aware': () => rangeAwarePolicy(),
  bot: () => botPolicy(),
};
