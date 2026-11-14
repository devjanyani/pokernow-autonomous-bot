// ============================================================
// Preflop strategy for 2-10 dealt-in players.
//
// SOURCES (each decision reports which one it used):
//   precomputed-chart  Heads-up table: src/core/ranges/preflop-charts.ts
//                      (hand-encoded HU ranges, ~100bb; an approximation of
//                      equilibrium, not a fresh solve).
//                      Ring: Greenline / Pekarstas 6-max chart packs
//                      (src/core/ranges/greenline-gto.ts, pekarstas-gto.ts),
//                      keyed by the position with the same number of players
//                      behind (LJ=UTG, HJ=MP, CO, BTN, SB, BB).
//                      Short stacks, one player behind: HU push/fold Nash
//                      (src/core/ranges/pushfold-nash.ts).
//   heuristic          Everything the charts do not cover (early seats at 7-10
//                      handed tables, limped pots, squeezes, cold 4-bets,
//                      multiway short-stack jams): percentile bands of the
//                      equity ordering in ranges/range.ts.
//   computed           Calling an all-in: Monte Carlo equity against the
//                      estimated ranges of every committed opponent, compared
//                      with the pot odds (chip EV; no ICM).
//   learned            Opponent tendencies scale the estimated ranges and gate
//                      a small number of explicit exploits.
// ============================================================

import { CardId, handClass, Rng } from '../cards';
import { charts as greenline, Cell } from '../../core/ranges/greenline-gto';
import { charts as pekarstas } from '../../core/ranges/pekarstas-gto';
import { preflopChartAction, PreflopScenario } from '../../core/ranges/preflop-charts';
import { isShove } from '../../core/ranges/pushfold-nash';
import { exploitNotes, PlayerProfile } from '../opponents/profile';
import { multiwayEquity } from '../equity/equity';
import { effectiveStack, HandState, legalActions, potTotal, seatOf } from '../table/engine';
import { jamFraction, JAM_BEHIND_MULT, openFraction } from '../ranges/preflop-model';
import { bandWeight, CLASS_BY_NAME, rangeFraction, toWeighted } from '../ranges/range';
import type { Mix as LibMix, SpotQuery, StrategyLibrary } from './library/library';
import type { PreflopScenario as LibScenario } from './library/types';
import { Candidate, EquitySummary } from './types';
import { VillainModel } from './villains';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface PreflopResult {
  candidates: Candidate[];
  chosen: number;
  basis: string[];
  adjustments: string[];
  equity: EquitySummary | null;
  evGap: number | null;
  evGapSe: number | null;
}

interface Mix { fold: number; call: number; raise: number; allin: number }

function chartCell(key: string, cls: string): Mix | null {
  const chart = greenline[key] ?? pekarstas[key];
  if (!chart) return null;
  const cell: Cell | undefined = chart[cls];
  const mix: Mix = { fold: 0, call: 0, raise: 0, allin: 0 };
  if (!cell) { mix.fold = 1; return mix; }
  if (typeof cell === 'string') { mix[cell] = 1; return mix; }
  if (Array.isArray(cell)) { mix[cell[0]] += 0.5; mix[cell[1]] += 0.5; return mix; }
  const w = clamp(cell.weight / 100, 0, 1);
  let tot = 0;
  for (const v of Object.values(cell.actions)) tot += v ?? 0;
  if (tot <= 0) { mix.fold = 1; return mix; }
  for (const [a, v] of Object.entries(cell.actions)) mix[a as keyof Mix] += (w * (v ?? 0)) / tot;
  mix.fold += 1 - w;
  // Near-uniform 3-way cells are unconverged nodes in the source charts, not real mixes.
  const live = [mix.call, mix.raise, mix.allin].filter((f) => f > 0.05);
  if (live.length >= 3 && Math.max(...live) - Math.min(...live) < 0.15) return { fold: 1, call: 0, raise: 0, allin: 0 };
  return mix;
}

/** Soft "top fraction" membership: 1 inside, fractional for the boundary class. */
function inTop(cls: string, frac: number): number {
  const c = CLASS_BY_NAME.get(cls);
  return c ? bandWeight(c, 0, clamp(frac, 0, 1)) : 0;
}

export function decidePreflop(
  h: HandState,
  heroSeat: number,
  heroCards: [CardId, CardId],
  villains: VillainModel[],
  profiles: Map<string, PlayerProfile>,
  rng: Rng,
  exploitWeight: number,
  /** Strategy library (version 2). Omitted = the version 1 chart lookup, kept for the benchmark baseline. */
  library?: StrategyLibrary,
): PreflopResult {
  const la = legalActions(h, heroSeat);
  if (!la) throw new Error('decidePreflop: Hero is not to act');
  const hero = seatOf(h, heroSeat);
  const bb = h.bigBlind;
  const cls = handClass(heroCards[0], heroCards[1]);
  const info = CLASS_BY_NAME.get(cls)!;
  const pct = (info.start + info.end) / 2;
  const dealt = h.seats.filter((s) => s.dealtIn);
  const hu = dealt.length === 2;
  const basis: string[] = [];
  const adjustments: string[] = [];

  // ---- read the preflop action so far ----
  let raises = 0, limpers = 0, callersAfterRaise = 0, heroRaiseLevel = 0;
  let firstRaiser: number | null = null, lastRaiser: number | null = null;
  for (const e of h.events) {
    if (e.street !== 'preflop' || e.kind.startsWith('post')) continue;
    if (e.kind === 'raise') {
      raises++; callersAfterRaise = 0;
      if (firstRaiser === null) firstRaiser = e.seat;
      lastRaiser = e.seat;
      if (e.seat === heroSeat) heroRaiseLevel = raises;
    } else if (e.kind === 'call') { if (raises === 0) limpers++; else callersAfterRaise++; }
  }
  const toCall = la.callAmount;
  const heroTotal = hero.stack + hero.streetCommit;
  const effBB = effectiveStack(h, heroSeat) / bb;
  const behind = villains.filter((v) => v.actsBehind && !v.allIn).length;
  const pot = potTotal(h);
  const lastRaiserSeat = lastRaiser !== null ? seatOf(h, lastRaiser) : null;
  const opener = firstRaiser !== null ? seatOf(h, firstRaiser) : null;
  const openerModel = opener ? villains.find((v) => v.seat === opener.seat) : undefined;
  // Width of the first raiser's range. Version 1 used the first-in width of the raiser's seat whatever had
  // happened before the raise, so a big blind raising over limpers was read as a 42% "open". Version 2 uses
  // the width of the range actually modelled for that player's line (open, isolation raise, ...).
  const openerF = !opener ? 0
    : library && openerModel ? clamp(rangeFraction(openerModel.range), 0.02, 0.95)
      : openFraction(opener.pos!.behindPreflop, hu) * (openerModel?.tend.preflopAggression ?? 1);

  // Library lookup for Hero's own decision. Returns the action mix for the actual holding, or null.
  const lookup = (scenario: LibScenario, villainBehind?: number, extra: Partial<SpotQuery> = {}): LibMix | null => {
    if (!library) return null;
    const q: SpotQuery = { scenario, players: dealt.length, heroBehind: hero.pos!.behindPreflop, villainBehind, effStackBB: effectiveStack(h, heroSeat) / bb, anteBB: h.ante / bb, ...extra };
    let m = library.find(q), nearest = '';
    // An opener seated earlier than the earliest seat any pack covers: the earliest covered seat is the nearest description.
    if (!m && villainBehind !== undefined && villainBehind > 5) { m = library.find({ ...q, villainBehind: 5 }); nearest = '; APPROXIMATION: the raiser sits earlier than the earliest seat in the data, nearest seat used'; }
    if (!m) return null;
    basis.push(`${m.basisTag}: ${library.cite(m)}${nearest}`);
    return library.mixFor(m, heroCards);
  };
  const cellFor = (key: string, scenario: LibScenario, villainBehind?: number, extra: Partial<SpotQuery> = {}): Mix | null => {
    if (library) return lookup(scenario, villainBehind, extra);
    const c = chartCell(key, cls);
    return c;
  };

  const mix: Mix = { fold: 0, call: 0, raise: 0, allin: 0 };
  let raiseTo = la.minRaiseTo;
  let equity: EquitySummary | null = null;
  let callEv: number | null = null, callEvSe: number | null = null;

  const openSize = (): number => {
    const base = hero.pos!.isSmallBlind && !hu ? 3 : hu ? 2.5 : 2.5;
    return h.currentBet > bb ? h.currentBet * base : (base + limpers) * bb;
  };

  // ---- 1. facing an all-in or a bet that commits Hero: computed call/fold ----
  const facingJam = raises >= 1 && toCall > 0 && ((lastRaiserSeat?.allIn ?? false) || toCall >= 0.4 * hero.stack);
  if (facingJam) {
    const committed = villains.filter((v) => (v.allIn || v.streetCommit >= h.currentBet - 1e-9) && v.streetCommit > bb);
    const opp = committed.length ? committed : villains.filter((v) => v.seat === lastRaiser);
    const est = multiwayEquity(heroCards, [], opp.map((v) => toWeighted(v.range, heroCards).range), 4000, rng.int(1 << 30));
    const heroAfter = hero.totalCommit + toCall;
    let winnable = 0;
    for (const s of dealt) winnable += Math.min(s.totalCommit + (s.seat === heroSeat ? toCall : 0), heroAfter);
    callEv = est.equity * winnable - toCall;
    callEvSe = est.stdErr * winnable;
    // Margin for range-estimate error and for players still to act behind.
    const margin = (0.015 + 0.02 * behind) * winnable;
    equity = { ...est };
    if (callEv > margin) mix.call = 1; else mix.fold = 1;
    basis.push(`computed: all-in call by chip EV vs ${opp.length} committed range(s) (equity ${(100 * est.equity).toFixed(1)}%, needs ${(100 * toCall / Math.max(1, winnable)).toFixed(1)}% + margin)`);
    basis.push('heuristic: opponent jam ranges are stack-depth percentile bands');
  }
  // ---- 2. short stack: jam or fold ----
  else if (effBB <= 12 && raises === 0 && la.canRaise) {
    let jam: number;
    if (behind === 1 && limpers === 0 && !hero.pos!.isBigBlind) {
      jam = isShove(cls, effBB) ? 1 : 0;
      basis.push(`precomputed-chart: heads-up push/fold Nash open-jam at ${effBB.toFixed(1)}bb (one player behind)`);
    } else if (toCall === 0) {
      jam = inTop(cls, 0.15);
      basis.push('heuristic: short-stack big blind jams top 15% over limpers');
    } else {
      const f = jamFraction(effBB) * JAM_BEHIND_MULT[clamp(behind, 1, 9)] * (limpers ? 0.8 : 1);
      jam = inTop(cls, f);
      basis.push(`heuristic: short-stack open-jam top ${(100 * f).toFixed(0)}% at ${effBB.toFixed(1)}bb with ${behind} behind`);
    }
    mix.allin = jam;
    if (toCall === 0) mix.call = 1 - jam; else mix.fold = 1 - jam;
  } else if (effBB <= 16 && raises >= 1) {
    const f = raises === 1 ? clamp(0.5 * openerF, 0.04, 0.3) : 0.035;
    const jam = la.canRaise ? inTop(cls, f) : 0;
    mix.allin = jam;
    const price = toCall / Math.max(1, pot + toCall);
    const cheapDefend = hero.pos!.isBigBlind && raises === 1 && price < 0.3 && pct < 0.45;
    if (!la.canRaise && inTop(cls, f) > 0.5) mix.call = 1;
    else if (cheapDefend) mix.call = 1 - jam; else mix.fold = 1 - jam;
    basis.push(`heuristic: short-stack re-jam top ${(100 * f).toFixed(1)}% at ${effBB.toFixed(1)}bb`);
  }
  // ---- 3. heads-up TABLE (two players dealt in) ----
  else if (hu) {
    if (raises === 0 && toCall === 0) {
      mix.raise = inTop(cls, 0.3); mix.call = 1 - mix.raise; raiseTo = 3.5 * bb;
      basis.push('heuristic: heads-up big blind raises top 30% over a limp');
    } else {
      const scenario: PreflopScenario = raises === 0 ? 'RFI' : raises === 1 ? 'vs-open' : raises === 2 ? 'vs-3bet' : 'vs-4bet';
      const a = preflopChartAction(cls, scenario).action;
      mix[a] = 1;
      raiseTo = raises === 0 ? 2.5 * bb : raises === 1 ? h.currentBet * 3.5 : h.currentBet * 2.4;
      basis.push(`precomputed-chart: heads-up table ${scenario} (preflop-charts.ts, ~100bb ranges)`);
    }
  }
  // ---- 4. ring game, deep ----
  else if (raises === 0) {
    const p6 = hero.pos!.chart6;
    if (toCall === 0) {
      const cell = library ? lookup('bb-vs-limp', undefined, { limpers }) : null;
      mix.raise = cell ? cell.raise + cell.allin : inTop(cls, 0.14);
      mix.call = 1 - mix.raise; raiseTo = (4 + limpers) * bb;
      basis.push(cell ? 'the chart is read for its raising hands; every other hand checks its option' : 'heuristic: big blind isolates top 14% over limpers, otherwise checks');
    } else if (limpers === 0) {
      const cell = library ? cellFor('', 'rfi') : p6 ? chartCell(`${p6}-RFI`, cls) : null;
      if (cell) {
        Object.assign(mix, cell);
        if (!library) basis.push(`precomputed-chart: 6-max ${p6}-RFI (seat ${hero.pos!.label}, ${hero.pos!.behindPreflop} behind)`);
      } else {
        const f = openFraction(hero.pos!.behindPreflop, false);
        mix.raise = inTop(cls, f); mix.fold = 1 - mix.raise;
        basis.push(`heuristic: ${hero.pos!.label} opens top ${(100 * f).toFixed(1)}% with ${hero.pos!.behindPreflop} players behind`);
      }
      raiseTo = openSize();
    } else {
      const cell = library ? cellFor('', 'vs-limp', undefined, { limpers }) : p6 ? chartCell(`${p6}-ISO`, cls) : null;
      const f = 0.6 * openFraction(hero.pos!.behindPreflop, false);
      mix.raise = cell ? cell.raise + cell.allin : inTop(cls, f);
      const late = hero.pos!.isButton || hero.pos!.label === 'CO' || hero.pos!.isSmallBlind;
      const playable = cls.length === 2 || cls.endsWith('s');
      const overlimp = late && playable && pct < 0.45 ? 1 - mix.raise : 0;
      mix.call = overlimp; mix.fold = 1 - mix.raise - mix.call;
      raiseTo = (hero.pos!.isSmallBlind ? 4 : 3 + limpers) * bb + (hero.pos!.isSmallBlind ? limpers * bb : 0);
      if (!cell) basis.push(`heuristic: isolate top ${(100 * f).toFixed(1)}% over ${limpers} limper(s)`);
      else if (!library) basis.push(`precomputed-chart: 6-max ${p6}-ISO over ${limpers} limper(s)`);
      else basis.push(`the isolation chart is read for its raising hands only, with ${limpers} limper(s)`);
      if (overlimp > 0) basis.push('heuristic: over-limp pairs / suited hands in late position');
    }
  } else if (raises === 1 && heroRaiseLevel === 0) {
    const p6 = hero.pos!.chart6, o6 = opener!.pos!.chart6 ?? 'UTG';
    const cell = callersAfterRaise > 0 ? (library ? lookup('vs-open-call', opener!.pos!.behindPreflop, { callers: callersAfterRaise }) : null)
      : library ? cellFor('', 'vs-open', opener!.pos!.behindPreflop) : p6 ? chartCell(`${p6}-vs-open-${o6}`, cls) : null;
    const ip = !hero.pos!.isSmallBlind && !hero.pos!.isBigBlind;
    if (cell) {
      Object.assign(mix, cell);
      if (!library) basis.push(`precomputed-chart: 6-max ${p6}-vs-open-${o6}${opener!.pos!.chart6 ? '' : ' (opener is earlier than 6-max UTG; nearest chart)'}`);
    } else {
      const v = clamp(0.3 * openerF, 0.025, 0.12) * (callersAfterRaise ? 0.85 : 1);
      const callW = hero.pos!.isBigBlind ? clamp(1.1 * openerF + 0.1 + 0.05 * callersAfterRaise, 0.1, 0.7)
        : ip && (hero.pos!.isButton || hero.pos!.label === 'CO') ? 0.45 * openerF + 0.03 * callersAfterRaise : 0.25 * openerF;
      mix.raise = inTop(cls, v);
      mix.call = Math.max(0, inTop(cls, v + callW) - mix.raise);
      mix.fold = 1 - mix.raise - mix.call;
      basis.push(`heuristic: vs ${opener!.pos!.label} ${library && limpers > 0 ? 'raise over limpers' : 'open'} (est. ${(100 * openerF).toFixed(0)}% range)${callersAfterRaise ? ` + ${callersAfterRaise} caller(s), squeeze sizing` : ''}: 3-bet top ${(100 * v).toFixed(1)}%, continue top ${(100 * (v + callW)).toFixed(0)}%`);
    }
    // Evidence-gated exploit: 3-bet light against a player who demonstrably over-folds to 3-bets.
    const note = exploitNotes(profiles.get(opener!.playerId)).find((n) => n.id === 'overfold-3bet');
    if (note && exploitWeight > 0 && mix.fold > 0.5 && pct < 0.3 && la.canRaise) {
      const shift = 0.5 * exploitWeight * mix.fold;
      mix.raise += shift; mix.fold -= shift;
      adjustments.push(`learned: ${opener!.name} ${note.text.toLowerCase()} (${note.evidence}); added light 3-bets`);
    }
    raiseTo = h.currentBet * ((ip ? 3 : 4) + callersAfterRaise);
  } else if (raises === 2) {
    const p6 = hero.pos!.chart6, r6 = lastRaiserSeat!.pos!.chart6;
    const cell = heroRaiseLevel !== 1 ? (library ? lookup('cold-4bet', lastRaiserSeat!.pos!.behindPreflop) : null)
      : callersAfterRaise > 0 ? (library ? lookup('vs-squeeze', lastRaiserSeat!.pos!.behindPreflop, { callers: callersAfterRaise }) : null)
        : library ? cellFor('', 'vs-3bet', lastRaiserSeat!.pos!.behindPreflop) : p6 && r6 ? chartCell(`${p6}-vs-3bet-${r6}`, cls) : null;
    if (cell) {
      Object.assign(mix, cell);
      if (!library) basis.push(`precomputed-chart: 6-max ${p6}-vs-3bet-${r6}`);
    } else if (heroRaiseLevel === 1) {
      const own = openFraction(hero.pos!.behindPreflop, false);
      mix.raise = inTop(cls, 0.026);
      const price = toCall / Math.max(1, pot + toCall);
      mix.call = effBB >= 40 && price < 0.36 ? Math.max(0, inTop(cls, clamp(0.5 * own, 0.05, 0.16)) - mix.raise) : 0;
      mix.fold = 1 - mix.raise - mix.call;
      basis.push('heuristic: vs 3-bet without a chart: 4-bet top 2.6%, call a band of the opening range when deep');
    } else {
      mix.raise = inTop(cls, 0.02); mix.fold = 1 - mix.raise;
      basis.push('heuristic: cold 4-bet top 2% only');
    }
    raiseTo = h.currentBet * (hero.pos!.isSmallBlind || hero.pos!.isBigBlind ? 2.7 : 2.3);
  } else {
    const p6 = hero.pos!.chart6, r6 = lastRaiserSeat?.pos?.chart6;
    const cell = heroRaiseLevel < 2 ? null : library ? (lastRaiserSeat ? cellFor('', 'vs-4bet', lastRaiserSeat.pos!.behindPreflop) : null) : p6 && r6 ? chartCell(`${p6}-vs-4bet-${r6}`, cls) : null;
    if (cell) {
      Object.assign(mix, cell);
      if (!library) basis.push(`precomputed-chart: 6-max ${p6}-vs-4bet-${r6}`);
    } else {
      mix.allin = inTop(cls, 0.013); mix.fold = 1 - mix.allin;
      basis.push('heuristic: vs 4-bet or more without a chart: continue top 1.3% (all-in)');
    }
    raiseTo = la.maxRaiseTo;
  }

  // ---- legalise the mix into concrete candidates ----
  if (!la.canRaise) { mix.call += mix.raise + mix.allin; mix.raise = 0; mix.allin = 0; }
  if (toCall === 0) { mix.call += mix.fold; mix.fold = 0; }            // never fold for free
  if (!la.canCall && toCall > 0) { mix.fold += mix.call; mix.call = 0; }
  let to = Math.round(raiseTo / (bb >= 2 ? 1 : 0.01)) * (bb >= 2 ? 1 : 0.01);
  to = clamp(to, la.minRaiseTo || to, la.maxRaiseTo || to);
  // Commitment rule: a raise that puts in most of the stack is an all-in.
  if (la.canRaise && to >= 0.45 * heroTotal) { mix.allin += mix.raise; mix.raise = 0; }
  const tot = mix.fold + mix.call + mix.raise + mix.allin;
  if (!(tot > 0)) { if (toCall === 0) mix.call = 1; else mix.fold = 1; }
  const norm = tot > 0 ? tot : 1;
  const passive = toCall === 0 ? 'check' : 'call';
  const candidates: Candidate[] = [];
  if (toCall > 0) candidates.push({ action: 'fold', label: 'fold', ev: callEv !== null ? 0 : null, evSe: callEv !== null ? 0 : null, freq: mix.fold / norm });
  candidates.push({ action: passive, label: passive, ev: toCall > 0 ? callEv : null, evSe: toCall > 0 ? callEvSe : null, freq: mix.call / norm });
  if (la.canRaise) {
    if (to < la.maxRaiseTo) candidates.push({ action: 'raise', to, label: `raise to ${to} (${(to / bb).toFixed(1)}bb)`, ev: null, evSe: null, freq: mix.raise / norm });
    candidates.push({ action: 'raise', to: la.maxRaiseTo, label: `all-in (${la.maxRaiseTo})`, ev: null, evSe: null, freq: (mix.allin + (to < la.maxRaiseTo ? 0 : mix.raise)) / norm });
  }
  // Sample the mixed strategy.
  let r = rng.next(), chosen = candidates.length - 1;
  for (let i = 0; i < candidates.length; i++) { r -= candidates[i].freq; if (r < 0) { chosen = i; break; } }
  if (candidates[chosen].freq <= 0) chosen = candidates.reduce((b, c, i) => (c.freq > candidates[b].freq ? i : b), 0);

  // Display equity against the players who have entered (or the big blind if nobody has).
  if (!equity) {
    const entered = villains.filter((v) => v.line !== 'unacted');
    const vs = entered.length ? entered : villains.slice(0, 1);
    if (vs.length) equity = { ...multiwayEquity(heroCards, [], vs.map((v) => toWeighted(v.range, heroCards).range), 1200, rng.int(1 << 30)) };
  }
  const gap = callEv !== null ? Math.abs(callEv) : null;
  return { candidates, chosen, basis, adjustments, equity, evGap: gap, evGapSe: callEvSe };
}
