// ============================================================
// Opponent-response calibration: a framework, not yet a result.
//
// The Phase 2.1 diagnosis found that every number describing how opponents respond (how often they fold to a
// bet, bet when checked to, raise) is hand-set. This module is the place where measured frequencies will
// replace them, built so that three different things can never be confused:
//
//   1. ASSUMPTION      a number somebody chose. Carries who chose it and why. Marked 'heuristic'.
//   2. POPULATION      what a named set of recorded hands shows: counts, an estimate and its interval,
//                      and the source the hands came from. Marked 'observed'. Exists only when counted.
//   3. PLAYER          what one player was seen to do, shrunk toward the population (or, with no population
//                      data, toward the assumption), with its own counts and interval.
//
// Every estimate returned says which of the three it rests on and how many real observations are behind it.
// With no observations the answer is the assumption, labelled as an assumption, with the wide interval of
// its stated strength. NOTHING here invents an observed value, and nothing here is read by the strategy
// engines: wiring a measured prior in is a separate, gated step (docs/bot/POKER_DATA_TRAINING_ROADMAP.md,
// steps 5 and 6).
//
// What is counted (per street, bet size class and heads-up / multiway):
//   facing a bet or raise   fold / call / raise
//   checked to, or first    bet / check
// Showdown-only hole cards do not bias these: they are frequencies of actions, not of hands.
// ============================================================

import { PRIORS } from '../../../src/bot/opponents/profile';
import type { HandState } from '../../../src/bot/table/engine';
import type { HandHistory } from './schema';
import { replayHand } from './validate';

export type Street = 'flop' | 'turn' | 'river';
export type SizeClass = 'small' | 'medium' | 'large' | 'overbet';
export const sizeClass = (potFraction: number): SizeClass => (potFraction < 0.4 ? 'small' : potFraction < 0.8 ? 'medium' : potFraction < 1.3 ? 'large' : 'overbet');

/** "facing|flop|medium|hu" or "open|turn|-|multi". */
export type SituationKey = string;
export const facingKey = (street: Street, size: SizeClass, headsUp: boolean): SituationKey => `facing|${street}|${size}|${headsUp ? 'hu' : 'multi'}`;
export const openKey = (street: Street, headsUp: boolean): SituationKey => `open|${street}|-|${headsUp ? 'hu' : 'multi'}`;

export interface Tally { fold: number; call: number; raise: number; bet: number; check: number }
const empty = (): Tally => ({ fold: 0, call: 0, raise: 0, bet: 0, check: 0 });
/** situation -> tally, and the same per player. */
export interface Counts { all: Map<SituationKey, Tally>; byPlayer: Map<string, Map<SituationKey, Tally>>; hands: number }
export const newCounts = (): Counts => ({ all: new Map(), byPlayer: new Map(), hands: 0 });

/** Add one finished (or partly played) hand. Only actions actually in the record are counted. */
export function countHand(c: Counts, h: HandState, skipPlayer?: string): void {
  c.hands++;
  const commit = new Map<number, number>();
  const folded = new Set<number>();
  let street = '', high = 0, lastFrac = 0;
  const live = () => h.seats.filter((s) => s.dealtIn && !folded.has(s.seat)).length;
  for (const e of h.events) {
    if (e.street !== street) { street = e.street; commit.clear(); high = 0; lastFrac = 0; }
    const mine = commit.get(e.seat) ?? 0;
    if (e.kind.startsWith('post')) { commit.set(e.seat, mine + e.amount); high = Math.max(high, mine + e.amount); continue; }
    if (street !== 'preflop') {
      const player = h.seats.find((s) => s.seat === e.seat)?.playerId ?? `seat${e.seat}`;
      const headsUp = live() === 2;
      const key = high > mine + 1e-9 ? facingKey(street as Street, sizeClass(lastFrac), headsUp) : openKey(street as Street, headsUp);
      const kind = e.kind as keyof Tally;
      if (player !== skipPlayer) {
        const bump = (m: Map<SituationKey, Tally>) => { const t = m.get(key) ?? empty(); t[kind]++; m.set(key, t); };
        bump(c.all);
        if (!c.byPlayer.has(player)) c.byPlayer.set(player, new Map());
        bump(c.byPlayer.get(player) as Map<SituationKey, Tally>);
      }
    }
    if (e.kind === 'fold') folded.add(e.seat);
    if (e.kind === 'bet' || e.kind === 'raise') { lastFrac = e.potBefore > 0 ? (e.to - mine) / e.potBefore : 0; high = e.to; commit.set(e.seat, e.to); }
    else if (e.kind === 'call') commit.set(e.seat, mine + e.amount);
  }
}

/** Count every hand of an imported set that replays cleanly. Returns how many were skipped. */
export function countHistories(c: Counts, hands: readonly HandHistory[]): { used: number; skipped: number } {
  let used = 0, skipped = 0;
  for (const hh of hands) {
    const r = replayHand(hh);
    if (!r.state || r.issues.some((i) => i.level === 'error')) { skipped++; continue; }
    countHand(c, r.state);
    used++;
  }
  return { used, skipped };
}

// ---- the three layers ---------------------------------------------------------------------------

export interface Assumption {
  mean: number;
  /** Strength in pseudo-observations: how many real observations it takes to outweigh it. */
  strength: number;
  basis: 'heuristic';
  /** Where the number is written down. */
  from: string;
}
export interface Observed { n: number; d: number; source: string }
export interface Estimate {
  mean: number; lo: number; hi: number;
  /** What the estimate rests on. 'assumption': no observation at all. */
  restsOn: 'assumption' | 'population' | 'player';
  /** Real observations behind it (0 for a bare assumption). */
  observations: number;
  assumption: Assumption;
  population: (Observed & { mean: number; lo: number; hi: number }) | null;
  player: (Observed & { raw: number }) | null;
  /** Plain statement for a report or an explanation line. */
  note: string;
}

function beta(a: number, b: number): { mean: number; lo: number; hi: number } {
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return { mean, lo: Math.max(0, mean - 1.645 * sd), hi: Math.min(1, mean + 1.645 * sd) };
}
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

/**
 * Estimate of one frequency from whatever exists. `population` and `player` are counts of real events
 * (n = times it happened, d = opportunities) or null. `playerShrink` is how many population-equivalent
 * observations a single player's own data must outweigh.
 */
export function estimate(assumption: Assumption, population: Observed | null, player: Observed | null, playerShrink = 20): Estimate {
  const check = (o: Observed | null, what: string) => { if (o && !(Number.isInteger(o.n) && Number.isInteger(o.d) && o.n >= 0 && o.d >= o.n)) throw new Error(`${what} counts must be whole numbers with 0 <= n <= d`); if (o && o.d > 0 && !o.source.trim()) throw new Error(`${what} counts need a source`); };
  check(population, 'population'); check(player, 'player');
  const a0 = assumption.mean * assumption.strength, b0 = (1 - assumption.mean) * assumption.strength;
  const pop = population && population.d > 0 ? { ...population, ...beta(a0 + population.n, b0 + population.d - population.n) } : null;
  const base = pop ? pop.mean : assumption.mean;
  if (player && player.d > 0) {
    const e = beta(base * playerShrink + player.n, (1 - base) * playerShrink + player.d - player.n);
    return { ...e, restsOn: 'player', observations: player.d, assumption, population: pop, player: { ...player, raw: player.n / player.d },
      note: `${pct(e.mean)} (${pct(e.lo)}–${pct(e.hi)}): this player ${player.n} of ${player.d} [${player.source}], shrunk toward ${pop ? `the population's ${pct(pop.mean)} (${pop.n} of ${pop.d}, ${pop.source})` : `an assumed ${pct(assumption.mean)} (${assumption.from}; no population data)`}` };
  }
  if (pop) return { mean: pop.mean, lo: pop.lo, hi: pop.hi, restsOn: 'population', observations: pop.d, assumption, population: pop, player: null, note: `${pct(pop.mean)} (${pct(pop.lo)}–${pct(pop.hi)}): observed ${pop.n} of ${pop.d} [${pop.source}]; the assumption was ${pct(assumption.mean)}` };
  const e = beta(a0, b0);
  return { ...e, restsOn: 'assumption', observations: 0, assumption, population: null, player: null, note: `${pct(e.mean)} (${pct(e.lo)}–${pct(e.hi)}): ASSUMED, not measured (${assumption.from})` };
}

/** The engine's present hand-set numbers, as assumptions. Nothing observed is implied by listing them. */
export function currentAssumption(action: 'fold' | 'call' | 'raise' | 'bet', street: Street): Assumption {
  const S = street.charAt(0).toUpperCase() + street.slice(1);
  const key = (action === 'bet' ? `betWhenCheckedTo${S}` : `${action}VsBet${S}`) as keyof typeof PRIORS;
  const p = PRIORS[key];
  return { mean: p.mean, strength: p.k, basis: 'heuristic', from: `PRIORS.${key} in src/bot/opponents/profile.ts` };
}

export interface CalibrationRow { situation: SituationKey; action: string; estimate: Estimate; assumptionOutsideInterval: boolean }
/** Every counted situation next to the current assumption for it. Situations nobody was seen in are not listed. */
export function calibrationTable(c: Counts, source: string, player?: string): CalibrationRow[] {
  const rows: CalibrationRow[] = [];
  const mine = player ? c.byPlayer.get(player) : undefined;
  for (const [key, t] of [...c.all].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [kind, street] = key.split('|') as ['facing' | 'open', Street];
    const actions = kind === 'facing' ? (['fold', 'call', 'raise'] as const) : (['bet'] as const);
    const d = kind === 'facing' ? t.fold + t.call + t.raise : t.bet + t.check;
    if (!d) continue;
    const pt = mine?.get(key);
    const pd = pt ? (kind === 'facing' ? pt.fold + pt.call + pt.raise : pt.bet + pt.check) : 0;
    for (const a of actions) {
      const est = estimate(currentAssumption(a, street), { n: t[a], d, source }, player && pt && pd ? { n: pt[a], d: pd, source: `${player}, ${source}` } : null);
      const ref = est.population as NonNullable<Estimate['population']>;
      rows.push({ situation: key, action: a, estimate: est, assumptionOutsideInterval: est.assumption.mean < ref.lo || est.assumption.mean > ref.hi });
    }
  }
  return rows;
}
