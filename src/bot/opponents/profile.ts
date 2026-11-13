// ============================================================
// Opponent profiles: per-player counters with explicit opportunity
// denominators, Beta-prior posteriors, style-classification probabilities and
// evidence-gated exploit notes.
//
// Every statistic is {n, d}: n = times the player did it, d = times the player
// actually had the opportunity. A spot where the action was impossible is never
// counted in d. A hand is applied to a profile at most once (handId dedupe).
// ============================================================

import { cardStr, comboIndex, CardId } from '../cards';
import { ActionEvent, HandState, Street } from '../table/engine';
import { computeFeatures, NEUTRAL, Tendencies } from '../ranges/postflop-model';

export interface Counter { n: number; d: number }

export const STAT_KEYS = [
  'vpip', 'pfr', 'rfi', 'limp', 'threeBet', 'coldCall', 'foldTo3Bet', 'fourBet',
  'cbetFlop', 'cbetTurn', 'foldToCbetFlop', 'foldToCbetTurn', 'checkRaise',
  'aggFreq', 'aggVsCall', 'wtsd', 'wsd',
  'foldVsBetFlop', 'foldVsBetTurn', 'foldVsBetRiver',
  'callVsBetFlop', 'callVsBetTurn', 'callVsBetRiver',
  'raiseVsBetFlop', 'raiseVsBetTurn', 'raiseVsBetRiver',
  'betWhenCheckedToFlop', 'betWhenCheckedToTurn', 'betWhenCheckedToRiver',
  'foldVsBetHeadsUp', 'foldVsBetMultiway',
  'vpipEarly', 'vpipLate', 'vpipBlinds', 'rfiEarly', 'rfiLate', 'rfiBlinds',
] as const;
export type StatKey = typeof STAT_KEYS[number];

/** Prior mean and strength (pseudo-observations). HEURISTIC population priors. */
export const PRIORS: Record<StatKey, { mean: number; k: number }> = {
  vpip: { mean: 0.26, k: 12 }, pfr: { mean: 0.18, k: 12 }, rfi: { mean: 0.22, k: 10 }, limp: { mean: 0.06, k: 10 },
  threeBet: { mean: 0.07, k: 20 }, coldCall: { mean: 0.12, k: 15 }, foldTo3Bet: { mean: 0.55, k: 10 }, fourBet: { mean: 0.1, k: 12 },
  cbetFlop: { mean: 0.55, k: 10 }, cbetTurn: { mean: 0.45, k: 10 }, foldToCbetFlop: { mean: 0.45, k: 10 }, foldToCbetTurn: { mean: 0.45, k: 10 },
  checkRaise: { mean: 0.08, k: 15 }, aggFreq: { mean: 0.33, k: 12 }, aggVsCall: { mean: 0.5, k: 8 },
  wtsd: { mean: 0.28, k: 12 }, wsd: { mean: 0.5, k: 8 },
  foldVsBetFlop: { mean: 0.45, k: 10 }, foldVsBetTurn: { mean: 0.45, k: 10 }, foldVsBetRiver: { mean: 0.5, k: 10 },
  callVsBetFlop: { mean: 0.43, k: 10 }, callVsBetTurn: { mean: 0.45, k: 10 }, callVsBetRiver: { mean: 0.42, k: 10 },
  raiseVsBetFlop: { mean: 0.12, k: 12 }, raiseVsBetTurn: { mean: 0.1, k: 12 }, raiseVsBetRiver: { mean: 0.08, k: 12 },
  betWhenCheckedToFlop: { mean: 0.4, k: 10 }, betWhenCheckedToTurn: { mean: 0.38, k: 10 }, betWhenCheckedToRiver: { mean: 0.35, k: 10 },
  foldVsBetHeadsUp: { mean: 0.45, k: 10 }, foldVsBetMultiway: { mean: 0.52, k: 10 },
  vpipEarly: { mean: 0.17, k: 12 }, vpipLate: { mean: 0.32, k: 12 }, vpipBlinds: { mean: 0.3, k: 12 },
  rfiEarly: { mean: 0.14, k: 12 }, rfiLate: { mean: 0.35, k: 12 }, rfiBlinds: { mean: 0.35, k: 12 },
};

export const SIZE_BUCKETS = ['<40% pot', '40-70%', '70-110%', '>110%'] as const;
const sizeBucket = (frac: number): number => (frac < 0.4 ? 0 : frac < 0.7 ? 1 : frac < 1.1 ? 2 : 3);

export interface ShowdownNote { handId: string; cards: string; line: string }

export interface PlayerProfile {
  version: 1;
  playerId: string;
  name: string;
  hands: number;
  firstSeen: number;
  lastSeen: number;
  stats: Record<StatKey, Counter>;
  /** Postflop bet sizes observed, by SIZE_BUCKETS. */
  betSizes: number[];
  /** For bets later revealed at showdown: sum of made-hand percentile and count, by size bucket. */
  shownStrengthSum: number[];
  shownStrengthN: number[];
  showdowns: ShowdownNote[];
  /** Hand ids already applied (most recent last, capped). */
  appliedHands: string[];
}

const APPLIED_CAP = 400;

export function emptyProfile(playerId: string, name = playerId, now = 0): PlayerProfile {
  const stats = {} as Record<StatKey, Counter>;
  for (const k of STAT_KEYS) stats[k] = { n: 0, d: 0 };
  return {
    version: 1, playerId, name, hands: 0, firstSeen: now, lastSeen: now, stats,
    betSizes: [0, 0, 0, 0], shownStrengthSum: [0, 0, 0, 0], shownStrengthN: [0, 0, 0, 0],
    showdowns: [], appliedHands: [],
  };
}

/** Repair a stored profile (missing keys after an upgrade, corrupted numbers). */
export function sanitizeProfile(p: PlayerProfile): PlayerProfile {
  const clean = emptyProfile(String(p.playerId), String(p.name ?? p.playerId), Number(p.firstSeen) || 0);
  clean.hands = Math.max(0, Number(p.hands) || 0);
  clean.lastSeen = Number(p.lastSeen) || 0;
  for (const k of STAT_KEYS) {
    const c = p.stats?.[k];
    const d = Math.max(0, Number(c?.d) || 0);
    clean.stats[k] = { d, n: Math.min(d, Math.max(0, Number(c?.n) || 0)) };
  }
  const arr4 = (a: unknown) => (Array.isArray(a) && a.length === 4 ? a.map((x) => Math.max(0, Number(x) || 0)) : [0, 0, 0, 0]);
  clean.betSizes = arr4(p.betSizes); clean.shownStrengthSum = arr4(p.shownStrengthSum); clean.shownStrengthN = arr4(p.shownStrengthN);
  clean.showdowns = Array.isArray(p.showdowns) ? p.showdowns.slice(-20) : [];
  clean.appliedHands = Array.isArray(p.appliedHands) ? p.appliedHands.slice(-APPLIED_CAP).map(String) : [];
  return clean;
}

// ---- extracting per-hand deltas --------------------------------------------

type Deltas = Partial<Record<StatKey, Counter>>;
interface HandDelta { stats: Deltas; betSizes: number[]; shownSum: number[]; shownN: number[]; showdown: ShowdownNote | null }

const posGroup = (h: HandState, seat: number): 'Early' | 'Late' | 'Blinds' => {
  const p = h.seats.find((s) => s.seat === seat)!.pos!;
  if (p.isBigBlind || (p.isSmallBlind && !p.isButton)) return 'Blinds';
  return p.isButton || p.label === 'CO' ? 'Late' : 'Early';
};

/**
 * Derive stat deltas for every dealt-in player from one COMPLETED hand.
 * Pure: the same hand always yields the same deltas.
 */
export function extractHandDeltas(h: HandState, reveals: Map<number, [CardId, CardId]> = new Map()): Map<string, HandDelta> {
  const out = new Map<number, HandDelta>();
  const dealt = h.seats.filter((s) => s.dealtIn);
  for (const s of dealt) out.set(s.seat, { stats: {}, betSizes: [0, 0, 0, 0], shownSum: [0, 0, 0, 0], shownN: [0, 0, 0, 0], showdown: null });
  const bump = (seat: number, key: StatKey, hit: boolean) => {
    const st = out.get(seat)!.stats;
    const c = st[key] ?? (st[key] = { n: 0, d: 0 });
    c.d++; if (hit) c.n++;
  };
  const once = new Set<string>();
  const bumpOnce = (seat: number, key: StatKey, hit: boolean) => {
    const id = `${seat}:${key}`;
    if (once.has(id)) { if (hit) { const c = out.get(seat)!.stats[key]!; if (c.n < c.d) c.n = c.d; } return; }
    once.add(id); bump(seat, key, hit);
  };
  const isAction = (e: ActionEvent) => !e.kind.startsWith('post');
  const isAgg = (e: ActionEvent) => e.kind === 'bet' || e.kind === 'raise';

  // ---- preflop ----
  const pre = h.events.filter((e) => e.street === 'preflop' && isAction(e));
  let raises = 0, entered = 0;
  let firstRaiser: number | null = null, lastRaiser: number | null = null;
  const vpip = new Set<number>(), pfr = new Set<number>(), hadChance = new Set<number>();
  for (const e of pre) {
    const g = posGroup(h, e.seat);
    // A big blind checking its option (or a walk) is not a voluntary opportunity.
    const forcedCheck = e.kind === 'check';
    if (!forcedCheck) hadChance.add(e.seat);
    if (raises === 0 && entered === 0 && !forcedCheck) {
      bumpOnce(e.seat, 'rfi', e.kind === 'raise');
      bumpOnce(e.seat, `rfi${g}` as StatKey, e.kind === 'raise');
    }
    if (raises === 0 && !forcedCheck) bumpOnce(e.seat, 'limp', e.kind === 'call');
    if (raises === 1 && e.seat !== firstRaiser) {
      bumpOnce(e.seat, 'threeBet', e.kind === 'raise');
      bumpOnce(e.seat, 'coldCall', e.kind === 'call');
    }
    if (raises === 2 && e.seat === firstRaiser && lastRaiser !== firstRaiser) {
      bumpOnce(e.seat, 'foldTo3Bet', e.kind === 'fold');
      bumpOnce(e.seat, 'fourBet', e.kind === 'raise');
    }
    if (e.kind === 'call' || e.kind === 'raise') { vpip.add(e.seat); entered++; }
    if (e.kind === 'raise') {
      pfr.add(e.seat); raises++;
      if (firstRaiser === null) firstRaiser = e.seat;
      lastRaiser = e.seat;
    }
  }
  for (const seat of hadChance) {
    const g = posGroup(h, seat);
    bump(seat, 'vpip', vpip.has(seat)); bump(seat, `vpip${g}` as StatKey, vpip.has(seat));
    bump(seat, 'pfr', pfr.has(seat));
  }

  // ---- postflop ----
  const sawFlop = h.board.length >= 3 ? new Set(dealt.filter((s) => !h.events.some((e) => e.street === 'preflop' && e.seat === s.seat && e.kind === 'fold')).map((s) => s.seat)) : new Set<number>();
  let prevStreetCbet = false;
  const featCache = new Map<number, ReturnType<typeof computeFeatures>>();
  for (const street of ['flop', 'turn', 'river'] as Street[]) {
    const evs = h.events.filter((e) => e.street === street && isAction(e));
    if (!evs.length) { prevStreetCbet = false; continue; }
    const S = street[0].toUpperCase() + street.slice(1) as 'Flop' | 'Turn' | 'River';
    const boardLen = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
    let bets = 0, cbetMade = false, cbetSeat: number | null = null;
    const checked = new Set<number>(), respondedToCbet = new Set<number>();
    let live = dealt.filter((s) => !h.events.some((e) => e.seq < evs[0].seq && e.seat === s.seat && e.kind === 'fold')).length;
    for (const e of evs) {
      const facing = e.facing > 1e-9;
      if (!facing) {
        bump(e.seat, `betWhenCheckedTo${S}` as StatKey, e.kind === 'bet');
        const pfaCanCbet = e.seat === lastRaiser && bets === 0 && (street === 'flop' || (street === 'turn' && prevStreetCbet));
        if (pfaCanCbet && street === 'flop') bump(e.seat, 'cbetFlop', e.kind === 'bet');
        if (pfaCanCbet && street === 'turn') bump(e.seat, 'cbetTurn', e.kind === 'bet');
        if (pfaCanCbet && e.kind === 'bet') { cbetMade = true; cbetSeat = e.seat; }
        if (e.kind === 'check') checked.add(e.seat);
      } else {
        bump(e.seat, `foldVsBet${S}` as StatKey, e.kind === 'fold');
        bump(e.seat, `callVsBet${S}` as StatKey, e.kind === 'call');
        bump(e.seat, `raiseVsBet${S}` as StatKey, e.kind === 'raise');
        bump(e.seat, live <= 2 ? 'foldVsBetHeadsUp' : 'foldVsBetMultiway', e.kind === 'fold');
        if (checked.has(e.seat)) { bump(e.seat, 'checkRaise', e.kind === 'raise'); checked.delete(e.seat); }
        if (cbetMade && bets === 1 && e.seat !== cbetSeat && !respondedToCbet.has(e.seat) && (street === 'flop' || street === 'turn')) {
          respondedToCbet.add(e.seat);
          bump(e.seat, street === 'flop' ? 'foldToCbetFlop' : 'foldToCbetTurn', e.kind === 'fold');
        }
      }
      if (e.kind !== 'check') bump(e.seat, 'aggFreq', isAgg(e));
      if (isAgg(e) || e.kind === 'call') bump(e.seat, 'aggVsCall', isAgg(e));
      if (e.kind === 'bet' && e.potBefore > 0) {
        const b = sizeBucket(e.amount / e.potBefore);
        const d = out.get(e.seat)!;
        d.betSizes[b]++;
        const cards = reveals.get(e.seat);
        if (cards) {
          let f = featCache.get(boardLen);
          if (!f) { f = computeFeatures(h.board.slice(0, boardLen)); featCache.set(boardLen, f); }
          const pct = f.hs[comboIndex(cards[0], cards[1])];
          if (pct >= 0) { d.shownSum[b] += pct; d.shownN[b]++; }
        }
      }
      if (isAgg(e)) bets++;
      if (e.kind === 'fold') live--;
    }
    prevStreetCbet = street === 'flop' && cbetMade;
  }
  // Preflop aggression also feeds the aggression-vs-call ratio.
  for (const e of pre) if (e.kind === 'raise' || e.kind === 'call') bump(e.seat, 'aggVsCall', e.kind === 'raise');

  for (const s of dealt) {
    if (!sawFlop.has(s.seat)) continue;
    const atShowdown = h.wentToShowdown && !s.folded;
    bump(s.seat, 'wtsd', atShowdown);
    if (atShowdown) bump(s.seat, 'wsd', (h.payouts?.get(s.seat) ?? 0) > 0);
    const cards = reveals.get(s.seat);
    if (atShowdown && cards) {
      const line = h.events.filter((e) => e.seat === s.seat && isAction(e)).map((e) => `${e.street[0]}:${e.kind}`).join(' ');
      out.get(s.seat)!.showdown = { handId: h.handId, cards: `${cardStr(cards[0])} ${cardStr(cards[1])}`, line };
    }
  }
  const byId = new Map<string, HandDelta>();
  for (const s of dealt) byId.set(s.playerId, out.get(s.seat)!);
  return byId;
}

/** Apply one completed hand to the profile map. Returns ids that were updated (already-applied hands are skipped). */
export function applyHandToProfiles(
  profiles: Map<string, PlayerProfile>,
  h: HandState,
  reveals: Map<number, [CardId, CardId]> = new Map(),
  now = 0,
): string[] {
  if (h.phase !== 'complete') return [];
  const updated: string[] = [];
  const deltas = extractHandDeltas(h, reveals);
  for (const s of h.seats) {
    if (!s.dealtIn) continue;
    let p = profiles.get(s.playerId);
    if (!p) { p = emptyProfile(s.playerId, s.name, now); profiles.set(s.playerId, p); }
    if (p.appliedHands.includes(h.handId)) continue;
    const d = deltas.get(s.playerId)!;
    for (const k of Object.keys(d.stats) as StatKey[]) { p.stats[k].n += d.stats[k]!.n; p.stats[k].d += d.stats[k]!.d; }
    for (let i = 0; i < 4; i++) { p.betSizes[i] += d.betSizes[i]; p.shownStrengthSum[i] += d.shownSum[i]; p.shownStrengthN[i] += d.shownN[i]; }
    if (d.showdown) { p.showdowns.push(d.showdown); if (p.showdowns.length > 20) p.showdowns.shift(); }
    p.hands++;
    p.name = s.name;
    p.lastSeen = now;
    p.appliedHands.push(h.handId);
    if (p.appliedHands.length > APPLIED_CAP) p.appliedHands.splice(0, p.appliedHands.length - APPLIED_CAP);
    updated.push(s.playerId);
  }
  return updated;
}

// ---- posteriors -------------------------------------------------------------

export interface Posterior { mean: number; sd: number; lo: number; hi: number; n: number; d: number; raw: number | null }

/** Beta(prior) posterior summary; lo/hi is an approximate 90% interval. */
export function posterior(p: PlayerProfile | undefined, key: StatKey): Posterior {
  const prior = PRIORS[key];
  const c = p?.stats[key] ?? { n: 0, d: 0 };
  const a = prior.mean * prior.k + c.n;
  const b = (1 - prior.mean) * prior.k + (c.d - c.n);
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return { mean, sd, lo: Math.max(0, mean - 1.645 * sd), hi: Math.min(1, mean + 1.645 * sd), n: c.n, d: c.d, raw: c.d > 0 ? c.n / c.d : null };
}

function normCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
const probAbove = (post: Posterior, x: number): number => 1 - normCdf((x - post.mean) / Math.max(1e-6, post.sd));

export interface StyleProbabilities { tightAggressive: number; looseAggressive: number; tightPassive: number; loosePassive: number; unclassified: number }

/** Classification probabilities. They summarise the statistics; they never replace them. */
export function classify(p: PlayerProfile | undefined): StyleProbabilities {
  const hands = p?.stats.vpip.d ?? 0;
  const unclassified = Math.exp(-hands / 20);
  const pLoose = probAbove(posterior(p, 'vpip'), 0.3);
  const pAgg = probAbove(posterior(p, 'aggVsCall'), 0.5);
  const k = 1 - unclassified;
  return {
    tightAggressive: k * (1 - pLoose) * pAgg,
    looseAggressive: k * pLoose * pAgg,
    tightPassive: k * (1 - pLoose) * (1 - pAgg),
    loosePassive: k * pLoose * (1 - pAgg),
    unclassified,
  };
}

export function styleLabel(s: StyleProbabilities): string {
  const e: [string, number][] = [['TAG', s.tightAggressive], ['LAG', s.looseAggressive], ['tight-passive', s.tightPassive], ['loose-passive', s.loosePassive], ['unclassified', s.unclassified]];
  e.sort((a, b) => b[1] - a[1]);
  return `${e[0][0]} ${(100 * e[0][1]).toFixed(0)}%`;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Behavioural knobs for the range / response model. Posterior means are already
 * shrunk toward the population prior; on top of that each deviation is capped by
 * d / (d + 20) so a handful of hands cannot produce an extreme adjustment.
 */
export function tendencies(p: PlayerProfile | undefined, exploitWeight = 1): Tendencies {
  if (!p || exploitWeight <= 0) return NEUTRAL;
  const cap = (dev: number, d: number) => exploitWeight * clamp(dev, -1, 1) * (d / (d + 20));
  const vp = posterior(p, 'vpip'), pf = posterior(p, 'pfr'), ag = posterior(p, 'aggFreq');
  const foldD = p.stats.foldVsBetFlop.d + p.stats.foldVsBetTurn.d + p.stats.foldVsBetRiver.d;
  const foldN = p.stats.foldVsBetFlop.n + p.stats.foldVsBetTurn.n + p.stats.foldVsBetRiver.n;
  const foldMean = (0.46 * 10 + foldN) / (10 + foldD);
  return {
    aggression: cap((ag.mean - PRIORS.aggFreq.mean) / 0.2, ag.d),
    stickiness: cap((0.46 - foldMean) / 0.25, foldD),
    looseness: 1 + cap(clamp(vp.mean / PRIORS.vpip.mean, 0.5, 2.2) - 1, vp.d),
    preflopAggression: 1 + cap(clamp(pf.mean / PRIORS.pfr.mean, 0.4, 2.2) - 1, pf.d),
  };
}

export interface ExploitNote { id: string; text: string; evidence: string }

/** Patterns whose 90% interval clears the baseline with a minimum sample. */
export function exploitNotes(p: PlayerProfile | undefined): ExploitNote[] {
  if (!p) return [];
  const notes: ExploitNote[] = [];
  const ev = (q: Posterior) => `${q.n}/${q.d} observed, posterior ${(100 * q.mean).toFixed(0)}% (90% interval ${(100 * q.lo).toFixed(0)}-${(100 * q.hi).toFixed(0)}%)`;
  const f3 = posterior(p, 'foldTo3Bet');
  if (f3.d >= 10 && f3.lo > 0.62) notes.push({ id: 'overfold-3bet', text: 'Folds to 3-bets too often', evidence: ev(f3) });
  const rc = posterior(p, 'callVsBetRiver');
  if (rc.d >= 10 && rc.lo > 0.55) notes.push({ id: 'river-station', text: 'Calls too many river bets', evidence: ev(rc) });
  const fc = posterior(p, 'foldToCbetFlop');
  if (fc.d >= 12 && fc.lo > 0.6) notes.push({ id: 'overfold-cbet', text: 'Over-folds to flop continuation bets', evidence: ev(fc) });
  const re = posterior(p, 'rfiEarly');
  if (re.d >= 20 && re.hi < 0.09) notes.push({ id: 'tight-ep', text: 'Unusually narrow early-position opening range', evidence: ev(re) });
  const bigN = p.shownStrengthN[2] + p.shownStrengthN[3], smallN = p.shownStrengthN[0] + p.shownStrengthN[1];
  if (bigN >= 4 && smallN >= 4) {
    const big = (p.shownStrengthSum[2] + p.shownStrengthSum[3]) / bigN, small = (p.shownStrengthSum[0] + p.shownStrengthSum[1]) / smallN;
    if (big - small > 0.12 && big > 0.85) notes.push({ id: 'big-bets-strong', text: 'Large bets are disproportionately strong at showdown', evidence: `revealed strength: large bets ${(100 * big).toFixed(0)}th pct (n=${bigN}) vs small ${(100 * small).toFixed(0)}th pct (n=${smallN})` });
  }
  return notes;
}

/** Storage boundary. The extension implements it over IndexedDB; tests and the simulator use memory. */
export interface ProfileStore {
  load(ids: string[]): Promise<PlayerProfile[]>;
  save(profiles: PlayerProfile[]): Promise<void>;
}

export class MemoryProfileStore implements ProfileStore {
  readonly data = new Map<string, PlayerProfile>();
  async load(ids: string[]): Promise<PlayerProfile[]> { return ids.map((i) => this.data.get(i)).filter((p): p is PlayerProfile => !!p).map((p) => structuredClone(p)); }
  async save(profiles: PlayerProfile[]): Promise<void> { for (const p of profiles) this.data.set(p.playerId, structuredClone(p)); }
}
