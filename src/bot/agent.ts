// ============================================================
// BotAgent: turns a validated HandState into one legal action plus a full
// explanation. Pure computation: it never touches the DOM or storage.
//
// How the heads-up / multiway branch is chosen (see docs/bot/STRATEGY.md):
//   counts.headsUpTable  -> exactly two players were DEALT IN: heads-up table
//                           rules and the heads-up preflop charts.
//   otherwise the pot type comes from the players still CONTESTING the pot:
//   one opponent left -> 'heads-up-pot' (ring-game ranges, one opponent in the
//   equity / EV simulation), two or more -> 'multiway' (joint simulation of
//   every opponent; all-in opponents included).
// ============================================================

import { CardId, cardsAreDistinct, hashSeed, hashString, Rng } from './cards';
import { applyHandToProfiles, PlayerProfile } from './opponents/profile';
import { decidePreflop } from './strategy/preflop';
import { PostflopSolver, PostflopResult } from './strategy/postflop';
import { PostflopSolverV1 } from './strategy/postflop-v1';
import { addCalib, Calibration, CalibKey, knobsFor } from './strategy/v3/model';
import { PopulationCalibration, RiverRangeCalibration, tiltRiverRange } from './strategy/v3/empirical';
import { ArtifactStatus, spotSupport } from './strategy/v3/artifacts';
import { PostflopSearchV3, V3Detail } from './strategy/v3/search';
import { analyseSpot, describeSpot, SpotInfo } from './strategy/spot';
import { CalibrationUse, Candidate, Decision, EngineName, StrategyNote } from './strategy/types';
import { buildTable, FeatureCache } from './strategy/villains';
import { defaultLibrary } from './strategy/library/builtin';
import {
  ActionInput, effectiveStack, HandState, legalActions, potTotal, tableCounts, validateAction,
} from './table/engine';
import { planBudget, shouldStop } from './time/budget';

export interface AgentOptions {
  /** 0 = ignore opponent statistics, 1 = full (still shrunk by sample size). */
  exploitWeight?: number;
  seed?: number;
  now?: () => number;
  /**
   * 'v2' (default): two-round look-ahead with betting-lead roles. 'v1': the engine as it was at
   * version 0.5.1, kept only as the benchmark baseline.
   */
  engine?: 'v1' | 'v2' | 'v3';
  /**
   * BENCHMARK ONLY (sim/bot/strategy-diag.ts): choose the engine separately for preflop decisions and for
   * postflop decisions, to measure the two sets of changes apart. Each overrides `engine` for its streets.
   * "Preflop v2" = strategy-library lookups and chart-based opponent ranges while deciding preflop.
   * "Postflop v2" = the two-round engine with the range-aware opponent model (which includes chart-based
   * preflop ranges for the opponents) while deciding on the flop, turn and river.
   * The extension never sets these.
   */
  preflopEngine?: 'v1' | 'v2' | 'v3';
  postflopEngine?: 'v1' | 'v2' | 'v3';
  /** Version 3: also evaluate the chosen action under two other opponent models (three times the evaluation work). Default true. */
  v3Sensitivity?: boolean;
  /**
   * Phase 2.5: population corrections of version 3's opponent responses and a tilt of the river bettor's range, both
   * fitted to real cash-game hands (strategy/v3/empirical.ts). The extension passes them only when the packaged
   * tables pass their checks (strategy/v3/artifacts.ts loadV3Artifacts).
   */
  v3Population?: PopulationCalibration;
  v3RiverRange?: RiverRangeCalibration;
  /**
   * Extension: apply the fitted tables only where the data they were fitted on covers the spot (artifacts.ts
   * spotSupport); elsewhere version 3 uses its uncalibrated baseline and says so. Off by default, so the offline
   * benchmarks of Phase 2.5 are reproduced exactly.
   */
  v3SpotChecks?: boolean;
  /** Extension: the load status of the fitted tables, quoted when one is missing or was rejected. */
  v3ArtifactStatus?: ArtifactStatus[];
  /** Diagnostics only (offline tools): called with every version 3 search and the decision made from it. */
  onV3Search?: (search: PostflopSearchV3, d: Decision) => void;
}

export interface DecideOptions {
  /** Milliseconds remaining on the action clock (null = unknown). */
  timeRemainingMs?: number | null;
  /** 0..1 confidence in the observed state. */
  stateConfidence?: number;
  /** Return true to abandon the computation (hand changed, turn passed). */
  isCancelled?: () => boolean;
  /** Called with the first valid decision and after refinements. */
  onProgress?: (d: Decision) => void;
  /** Yield to the event loop between batches (browser). */
  yieldFn?: () => Promise<void>;
  /** Fixed sample count: bypasses the clock (simulator / tests, fully reproducible). */
  fixedSamples?: number;
  jitterMs?: number;
}

export class DecisionCancelled extends Error {
  constructor() { super('decision cancelled'); this.name = 'DecisionCancelled'; }
}

export class BotAgent {
  readonly profiles = new Map<string, PlayerProfile>();
  /**
   * Version 3 residual calibration per player (model.ts CALIB_GRID), from version 3's own bets and raises. In memory
   * only: version 3 is an offline engine, and the extension does not use it.
   */
  readonly v3Calibration = new Map<string, Calibration>();
  private readonly v3Pending = new Map<string, { playerId: string; oppSeat: number; heroSeat: number; ev: number; key: CalibKey; predicted: number[] }>();
  private readonly cache = new FeatureCache();
  private readonly exploitWeight: number;
  private readonly seed: number;
  private readonly now: () => number;
  private readonly engine: 'v1' | 'v2' | 'v3';
  private readonly preflopEngine: 'v1' | 'v2' | 'v3';
  private readonly postflopEngine: 'v1' | 'v2' | 'v3';
  private readonly v3Sensitivity: boolean;
  private readonly onV3Search?: (search: PostflopSearchV3, d: Decision) => void;
  private readonly v3Population?: PopulationCalibration;
  private readonly v3RiverRange?: RiverRangeCalibration;
  private readonly v3SpotChecks: boolean;
  private readonly v3ArtifactStatus: ArtifactStatus[];
  /** What the empirical corrections changed in the last version 3 search (for the explanation). */
  private v3EmpiricalNote: string[] = [];
  /** Whether each fitted table was used in the last version 3 search, and why not. */
  private v3CalibUse: NonNullable<StrategyNote['calibration']> = { population: 'unavailable', river: 'unavailable', notes: [] };

  constructor(opts: AgentOptions = {}) {
    this.exploitWeight = opts.exploitWeight ?? 1;
    this.seed = opts.seed ?? 1;
    this.engine = opts.engine ?? 'v2';
    this.preflopEngine = opts.preflopEngine ?? this.engine;
    this.postflopEngine = opts.postflopEngine ?? this.engine;
    this.v3Sensitivity = opts.v3Sensitivity ?? true;
    this.onV3Search = opts.onV3Search;
    this.v3Population = opts.v3Population;
    this.v3RiverRange = opts.v3RiverRange;
    this.v3SpotChecks = opts.v3SpotChecks ?? false;
    this.v3ArtifactStatus = opts.v3ArtifactStatus ?? [];
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** Record a completed hand in the opponent profiles (idempotent per hand id). */
  observeHand(h: HandState, reveals: Map<number, [CardId, CardId]> = new Map(), now = 0): string[] {
    this.observeV3Responses(h);
    return applyHandToProfiles(this.profiles, h, reveals, now);
  }

  /**
   * Only the version 3 residual calibration from a completed hand (the opponent's answer to Hero's bets and raises),
   * without touching the profiles: for a second agent that shares the profiles of the first (shadow comparison).
   */
  observeV3Responses(h: HandState): void {
    for (const [id, p] of this.v3Pending) {
      if (!id.startsWith(`${h.handId}:`)) continue;
      const mine = h.events[p.ev];
      if (mine && mine.seat === p.heroSeat && (mine.kind === 'bet' || mine.kind === 'raise')) {
        const next = h.events.slice(p.ev + 1).find((e) => e.seat === p.oppSeat && !e.kind.startsWith('post'));
        if (next) {
          const cal: Calibration = this.v3Calibration.get(p.playerId) ?? {};
          addCalib(cal, p.key, p.predicted, p.key === 'raiseVsBet' ? next.kind === 'raise' : next.kind === 'fold');
          this.v3Calibration.set(p.playerId, cal);
        }
      }
    }
    this.v3Pending.clear();
  }

  /** The engine asked for on this street. */
  private requested(h: HandState): EngineName { return h.street === 'preflop' ? this.preflopEngine : this.postflopEngine; }

  private prepare(h: HandState, heroSeat: number, heroCards: [CardId, CardId]) {
    const la = legalActions(h, heroSeat);
    if (!la) throw new Error(`seat ${heroSeat} is not to act`);
    if (!cardsAreDistinct([...heroCards, ...h.board])) throw new Error('hero cards collide with the board');
    const counts = tableCounts(h, heroSeat);
    const mode: Decision['mode'] = counts.headsUpTable ? 'heads-up-table' : counts.opponentsContesting <= 1 ? 'heads-up-pot' : 'multiway';
    const legacy = (h.street === 'preflop' ? this.preflopEngine : this.postflopEngine) === 'v1';
    const { villains, heroPerceived } = buildTable(h, heroSeat, heroCards, this.profiles, this.exploitWeight, this.cache, legacy);
    const rng = new Rng(hashSeed(this.seed, hashString(h.handId), h.events.length, heroSeat));
    const spot = analyseSpot(h, heroSeat, heroCards);
    return { la, counts, mode, villains, heroPerceived, rng, spot, legacy };
  }

  private finish(
    h: HandState, heroSeat: number, prep: ReturnType<BotAgent['prepare']>, candidates: Candidate[], chosen: number,
    extra: Pick<Decision, 'equity' | 'basis' | 'adjustments' | 'evGap' | 'evGapSe' | 'samples' | 'provisional'> & { lowConfidence?: boolean; fallback?: string }, t0: number,
  ): Decision {
    let pick = candidates[chosen];
    let input: ActionInput = { seat: heroSeat, kind: pick.action, to: pick.to };
    const basis = extra.basis.slice();
    const spot: SpotInfo = prep.spot;
    if (!prep.legacy) {
      const nameOf = (seat: number) => h.seats.find((s) => s.seat === seat)?.name ?? `seat ${seat}`;
      basis.unshift(`spot: ${describeSpot(spot, nameOf)}`);
      if (spot.offRange) {
        basis.push(h.street === 'preflop'
          ? `out-of-distribution: Hero's hand is not in the range the model gives a player who took this preflop line (${spot.heroLine}); the advice below is for the hand actually held`
          : `out-of-distribution: Hero's hand is not in the range the model gives this preflop line (${spot.heroLine}). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence`);
      }
    }
    // Free-check rule, enforced in one place for every strategy branch and every street:
    // folding is never returned when checking costs nothing.
    if (pick.action === 'fold' && prep.la.canCheck) {
      basis.push('rule: a check is free here, so the fold was replaced by a check');
      pick = { action: 'check', label: 'check', ev: null, evSe: null, freq: 1 };
      input = { seat: heroSeat, kind: 'check' };
    }
    // Final legality gate: nothing leaves the agent that the rules engine rejects.
    if (validateAction(h, input)) {
      const safe = prep.la.canCheck ? 'check' : 'fold';
      basis.push(`safety: "${pick.label}" failed validation, replaced by ${safe}`);
      pick = { action: safe, label: safe, ev: null, evSe: null, freq: 1 };
      input = { seat: heroSeat, kind: safe };
    }
    const adjustments = extra.adjustments.slice();
    for (const v of prep.villains) {
      const t = v.tend;
      if (Math.abs(t.aggression) > 0.15 || Math.abs(t.stickiness) > 0.15 || Math.abs(t.looseness - 1) > 0.15 || Math.abs(t.preflopAggression - 1) > 0.15) {
        adjustments.push(`learned: ${v.name} modelled with aggression ${t.aggression.toFixed(2)}, stickiness ${t.stickiness.toFixed(2)}, looseness x${t.looseness.toFixed(2)}, preflop raising x${t.preflopAggression.toFixed(2)}`);
      }
    }
    let uncertainty: string;
    if (extra.evGap !== null && extra.evGapSe !== null) {
      const z = extra.evGap / Math.max(1e-9, extra.evGapSe);
      uncertainty = z > 3 ? `clear: best action leads by ${extra.evGap.toFixed(1)} chips (${z.toFixed(1)} standard errors)`
        : z > 1.5 ? `moderate: lead of ${extra.evGap.toFixed(1)} chips is ${z.toFixed(1)} standard errors`
          : `close: lead of ${extra.evGap.toFixed(1)} chips is within noise (${z.toFixed(1)} standard errors); mixing`;
      uncertainty += '. Standard errors cover sampling noise only; the opponent model is heuristic.';
    } else uncertainty = 'frequency-based decision (chart or percentile rule); no EV estimate.';
    if (prep.villains.every((v) => (this.profiles.get(v.playerId)?.hands ?? 0) < 20)) uncertainty += ' Opponent reads are weak (fewer than 20 hands each).';
    const poor = prep.legacy ? [] : prep.villains.filter((v) => v.poorFit);
    for (const v of poor) basis.push(`model-dependent: ${v.name}'s betting line is poorly explained by the behaviour model (${(100 * v.retained).toFixed(1)}% of the starting range fits it), so part of the starting range was kept`);
    const lower = !prep.legacy && (spot.offRange || extra.lowConfidence === true || poor.length > 0);
    if (lower) uncertainty += ' Lower confidence: see the notes marked out-of-distribution or model-dependent.';
    // Which engine decided. Version 3 decisions overwrite this in decisionV3; anything reaching here with version 3
    // requested is a fallback, and the reason is stated.
    const requested = this.requested(h);
    const used: EngineName = prep.legacy ? 'v1' : 'v2';
    const strategy: StrategyNote = {
      requested, used,
      fallback: requested === 'v3' ? (h.street === 'preflop' ? 'preflop: version 3 has no preflop engine, so version 2\'s preflop charts and ranges decided' : extra.fallback ?? 'version 3 not used; version 2 decided') : null,
    };
    return {
      action: input.kind, to: input.to, label: pick.label, street: h.street, candidates,
      equity: extra.equity,
      ranges: prep.villains.map((v) => ({ seat: v.seat, name: v.name, line: v.line, summary: v.summary, basis: prep.legacy ? 'heuristic' as const : (v.rangeBasis === 'solver' ? 'precomputed-chart' as const : v.rangeBasis), source: prep.legacy ? undefined : `${v.rangeSource}; postflop actions narrowed by the heuristic behaviour model` })),
      adjustments, basis, uncertainty, evGap: extra.evGap, evGapSe: extra.evGapSe,
      counts: prep.counts, mode: prep.mode, samples: extra.samples, computeMs: this.now() - t0, provisional: extra.provisional,
      ...(prep.legacy ? {} : { spot, confidence: lower ? 'lower' as const : 'normal' as const, engine: 'v2' as const }),
      strategy,
    };
  }

  private preflop(h: HandState, heroSeat: number, heroCards: [CardId, CardId], prep: ReturnType<BotAgent['prepare']>, t0: number): Decision {
    const r = decidePreflop(h, heroSeat, heroCards, prep.villains, this.profiles, prep.rng, this.exploitWeight, prep.legacy ? undefined : defaultLibrary());
    return this.finish(h, heroSeat, prep, r.candidates, r.chosen, {
      equity: r.equity, basis: r.basis, adjustments: r.adjustments, evGap: r.evGap, evGapSe: r.evGapSe,
      samples: r.equity?.samples ?? 0, provisional: false,
    }, t0);
  }

  /**
   * Version 3 applies to heads-up pots after the flop. Elsewhere the agent uses version 2 and says why.
   * Returns the search, or the reason it was not used.
   */
  private newSearchV3(h: HandState, heroSeat: number, heroCards: [CardId, CardId], prep: ReturnType<BotAgent['prepare']>): PostflopSearchV3 | string {
    if (this.postflopEngine !== 'v3') return 'not selected';
    if (prep.villains.length !== 1) return `${prep.villains.length} opponents in the pot: version 3 searches heads-up pots only`;
    let v = prep.villains[0];
    const seed = prep.rng.int(1 << 30);
    const knobs = knobsFor(this.profiles.get(v.playerId), v.tend, this.exploitWeight, this.v3Calibration.get(v.playerId));
    this.v3EmpiricalNote = [];
    const use: { population: CalibrationUse; river: CalibrationUse; notes: string[] } = { population: 'unavailable', river: 'unavailable', notes: [] };
    const why = (name: ArtifactStatus['name']) => { const s = this.v3ArtifactStatus.find((x) => x.name === name); return s && s.state !== 'loaded' ? `${s.state}: ${s.reason}` : 'not supplied'; };
    const support = this.v3SpotChecks ? spotSupport(prep.counts.headsUpTable) : { ok: true, reason: null };
    if (!this.v3Population) use.notes.push(`population calibration unavailable (${why('population-calibration')}): the hand-set response model is used uncalibrated`);
    else if (!support.ok) { use.population = 'not applicable'; use.notes.push(`population calibration not applied (${support.reason}): the hand-set response model is used uncalibrated`); }
    else {
      use.population = 'applied';
      knobs.population = this.v3Population;
      this.v3EmpiricalNote.push(`empirical (${this.v3Population.source}): the opponent's fold, call, raise and bet probabilities include population corrections fitted to real cash-game hands against this model's own predictions; the response functions themselves are hand-set`);
    }
    const facingRiverBet = h.street === 'river' && prep.la.callAmount > 0 && h.aggressor.river === v.seat;
    if (!this.v3RiverRange) use.notes.push(`river range tilt unavailable (${why('river-range')})`);
    else if (!facingRiverBet) use.river = 'not applicable';
    else if (!support.ok) { use.river = 'not applicable'; use.notes.push(`river range tilt not applied (${support.reason}): version 2's river range is used`); }
    if (this.v3RiverRange && facingRiverBet && support.ok) {
      use.river = 'applied';
      const betTurn = h.events.some((e) => e.street === 'turn' && e.seat === v.seat && (e.kind === 'bet' || e.kind === 'raise'));
      const frac = prep.la.callAmount / Math.max(1e-9, potTotal(h) - prep.la.callAmount);
      const t = tiltRiverRange(this.v3RiverRange, v.range, this.cache.get(h.board).hs, frac, betTurn);
      v = { ...v, range: t.range };
      this.v3EmpiricalNote.push(`empirical (${this.v3RiverRange.source}): the bettor's river range is version 2's estimate re-weighted by hand strength as fitted to revealed holdings of called river bets (cell ${t.cell}); value / bluff composition is a model hypothesis`);
    }
    this.v3CalibUse = use;
    try {
      return new PostflopSearchV3(h, heroSeat, heroCards, v, knobs, this.cache.get(h.board), seed, prep.heroPerceived);
    } catch (e) { return `search not built: ${(e as Error).message}`; }
  }

  private newSolver(h: HandState, heroSeat: number, heroCards: [CardId, CardId], prep: ReturnType<BotAgent['prepare']>): PostflopSolver | PostflopSolverV1 {
    const seed = prep.rng.int(1 << 30);
    return prep.legacy ? new PostflopSolverV1(h, heroSeat, heroCards, prep.villains, this.cache.get(h.board), seed)
      : new PostflopSolver(h, heroSeat, heroCards, prep.villains, this.cache.get(h.board), seed, prep.heroPerceived);
  }

  private postflopDecision(h: HandState, heroSeat: number, prep: ReturnType<BotAgent['prepare']>, solver: PostflopSolver | PostflopSolverV1, provisional: boolean, t0: number, fallback?: string): Decision {
    const res = solver.result();
    // Sample the mix with a fixed draw so refinement does not flip-flop on the random number.
    let r = new Rng(hashSeed(this.seed, hashString(h.handId), h.events.length, 7)).next();
    let chosen = res.best;
    for (let i = 0; i < res.candidates.length; i++) { r -= res.candidates[i].freq; if (r < 0) { chosen = i; break; } }
    if (prep.legacy) {
      return this.finish(h, heroSeat, prep, res.candidates, chosen, {
        equity: res.equity,
        basis: [
          `computed: Monte Carlo EV of ${res.candidates.length} candidate actions over ${res.samples} joint deals vs ${prep.villains.length} opponent range(s)`,
          'heuristic: opponent ranges and responses from ranges/postflop-model.ts; realization factor on flop/turn',
        ],
        adjustments: [], evGap: res.evGap, evGapSe: res.evGapSe, samples: res.samples, provisional,
      }, t0);
    }
    const r2 = res as PostflopResult;
    const basis = [
      `calculated approximation: Monte Carlo EV of ${res.candidates.length} candidate actions over ${res.samples} joint deals vs ${prep.villains.length} opponent range(s), this street and the next street's betting played out`,
      "heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver",
    ];
    const pick = res.candidates[chosen], line = r2.lines[chosen];
    const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
    let lowConfidence = false;
    if (pick.action === 'bet' || pick.action === 'raise') {
      const eqc = line.equityWhenCalled;
      const purpose = eqc === null ? 'bluff (never called in the simulation)'
        : eqc >= 0.5 ? 'value bet: ahead of the hands that call'
          : res.equity.equity >= 1 / (prep.villains.length + 1) + 0.1 && eqc >= 0.35 ? 'protection / thin value bet: ahead of the ranges now, about even or behind when called'
            : eqc < 0.33 ? 'bluff or semi-bluff: behind when called, profit comes from folds' : 'thin bet: marginal against the hands that call';
      basis.push(`bet type: ${pick.action === 'raise' ? 'raise' : prep.spot.heroBetType}; purpose: ${purpose}`);
      basis.push(`modelled responses: all fold ${pct(line.foldAll)}, call ${pct(line.called)}, raise ${pct(line.raised)}${eqc === null ? '' : `; Hero wins ${pct(eqc)} at showdown against the hands that call`}${line.plan ? `; plan: ${line.plan}` : ''}`);
      if (eqc === null || eqc < 0.33) { lowConfidence = true; basis.push('model-dependent: this bet is profitable only if opponents fold as often as the heuristic model predicts'); }
    } else if (pick.action === 'check') {
      basis.push(prep.villains.some((v) => v.actsBehind && !v.allIn) ? `check: an opponent bets behind in ${pct(line.betBehind)} of deals${line.plan ? `; plan: ${line.plan}` : ''}` : 'check: nobody is left to bet behind Hero on this street');
    } else if (pick.action === 'call') {
      const price = prep.la.callAmount / Math.max(1, potTotal(h) + prep.la.callAmount);
      basis.push(`call: needs ${pct(price)} of the pot, raw showdown equity ${pct(res.equity.equity)}${res.equity.equity < 0.5 && h.street === 'river' ? ' (bluff-catcher: behind the betting range on average, priced in by the pot odds)' : ''}`);
    }
    // Opponent-model sensitivity, kept apart from sampling error: the two response scenarios side by side.
    const chips = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
    if (pick.evModel !== undefined && pick.evPessimistic !== undefined) {
      basis.push(`opponent-model sensitivity: this ${pick.action} is worth ${chips(pick.evModel)} chips if opponents respond as modelled and ${chips(pick.evPessimistic)} if they fold less often; the lower figure is the one used. Sampling error (±${(pick.evSe ?? 0).toFixed(1)}) does not cover this difference`);
    }
    if (r2.bestModel !== res.best) {
      const alt = res.candidates[r2.bestModel];
      basis.push(`model-dependent: under the modelled responses alone "${alt.label}" would be best (${chips(alt.evModel ?? alt.ev ?? 0)} chips); it is not chosen because it is worth ${chips(alt.ev ?? 0)} against opponents who fold less often`);
    }
    return this.finish(h, heroSeat, prep, res.candidates, chosen, {
      equity: res.equity, basis, adjustments: [], evGap: res.evGap, evGapSe: res.evGapSe, samples: res.samples, provisional, lowConfidence, fallback,
    }, t0);
  }

  private decisionV3(h: HandState, heroSeat: number, prep: ReturnType<BotAgent['prepare']>, search: PostflopSearchV3, provisional: boolean, t0: number, final = true): Decision {
    const res = search.result(2.5, final);
    let r = new Rng(hashSeed(this.seed, hashString(h.handId), h.events.length, 7)).next();
    let chosen = res.best;
    for (let i = 0; i < res.candidates.length; i++) { r -= res.candidates[i].freq; if (r < 0) { chosen = i; break; } }
    const d: V3Detail = res.v3;
    const chips = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
    const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
    const pick = res.candidates[chosen], line = res.lines[chosen];
    const basis = [
      `calculated approximation (version 3, experimental): best response to the opponent model over a betting tree of ${d.nodes} nodes (this street${search.cfg.streets === 2 && h.street !== 'river' ? ' and the next' : ''}), ${d.deals} sampled deals; Hero may check-raise, re-raise, or call now and bet or raise later`,
      "heuristic: the opponent's range comes from the range-aware behaviour model; its responses depend on the betting so far (strategy/v3/model.ts), not on a solver",
    ];
    const plan = d.plans[chosen];
    if (plan.length) basis.push(`plan after ${pick.label}: ${plan.join('; ')}`);
    const dec = d.decomposition[chosen];
    if (dec && (pick.action === 'bet' || pick.action === 'raise')) {
      const eqc = line.equityWhenCalled;
      basis.push(`modelled responses: all fold ${pct(line.foldAll)}, call ${pct(line.called)}, raise ${pct(line.raised)}${eqc === null ? '' : `; Hero wins ${pct(eqc)} at showdown against the hands that call`}`);
      const purpose = dec.fromFolds > Math.max(dec.fromCalls, 0) && (eqc ?? 0) < 0.4 ? 'mainly fold equity (bluff or semi-bluff)'
        : dec.fromCalls > 0 && dec.fromFolds > 0 ? 'value when called and fold equity together' : dec.fromCalls > 0 ? 'value: profit comes from being called' : 'none of the responses is profitable on its own';
      basis.push(`where the value comes from: folds ${chips(dec.fromFolds)}, calls ${chips(dec.fromCalls)}, raises ${chips(dec.fromRaises)} chips → ${purpose}`);
    }
    if (d.checkOptions) {
      for (const co of d.checkOptions) {
        const best = co.options.slice().sort((a, b) => b.ev - a.ev)[0];
        basis.push(`after a check, ${co.nextStreet ? `on the ${co.street} ` : ''}if the opponent bets ${co.facing.replace(/^bet /, '')} (${pct(co.probability)} of deals): ${co.options.map((o) => `${o.label} ${chips(o.ev)}`).join(', ')}; plan: ${co.chosen ?? best.label}${best.purpose ? ` — ${best.purpose}` : ''}`);
      }
    }
    basis.push(`model uncertainty: decided against a mixture of opponents Hero cannot tell apart: ${d.mixture.map((m) => `${pct(m.weight)} ${m.name}`).join(', ')} (the share of the two deviations shrinks as this opponent's own responses are observed)`);
    basis.push(...this.v3EmpiricalNote, ...this.v3CalibUse.notes);
    for (const s of d.sensitivity) basis.push(`opponent-model sensitivity: if the opponent ${s.scenario === 'as modelled' ? 'plays exactly as modelled' : s.scenario}, the chosen action is worth ${chips(s.evOfChosen)} chips and the best would be "${s.best}" (${chips(s.evBest)})`);
    const ev = search.cfg;
    void ev;
    const dd = this.finish(h, heroSeat, prep, res.candidates, chosen, {
      equity: res.equity, basis, adjustments: [], evGap: res.evGap, evGapSe: res.evGapSe, samples: res.samples, provisional,
      lowConfidence: (pick.action === 'bet' || pick.action === 'raise') && (line.equityWhenCalled === null || line.equityWhenCalled < 0.33),
    }, t0);
    const knobs = knobsFor(this.profiles.get(prep.villains[0].playerId), prep.villains[0].tend, this.exploitWeight, this.v3Calibration.get(prep.villains[0].playerId));
    if (!provisional && (pick.action === 'bet' || pick.action === 'raise')) {
      const curve = search.calibCurve(chosen);
      if (curve) this.v3Pending.set(`${h.handId}:${h.events.length}`, { playerId: prep.villains[0].playerId, oppSeat: prep.villains[0].seat, heroSeat, ev: h.events.length, ...curve });
    }
    for (const e of knobs.evidence) dd.adjustments.push(`learned (version 3): ${prep.villains[0].name}: ${e}`);
    const cal = { ...this.v3CalibUse, notes: this.v3CalibUse.notes.slice() };
    const opponentModel = cal.population === 'applied'
      ? `version 3's hand-set response model with the population calibration (model D) fitted to real cash-game hands (${this.v3Population?.source ?? '?'})`
      : 'version 3\'s hand-set response model, uncalibrated (baseline)';
    return { ...dd, engine: 'v3', strategy: { requested: 'v3', used: 'v3', fallback: null, opponentModel, calibration: cal } };
  }

  /** Fully synchronous decision with a fixed sample count (simulator, tests). */
  decideSync(h: HandState, heroSeat: number, heroCards: [CardId, CardId], samples = 600): Decision {
    const t0 = this.now();
    const prep = this.prepare(h, heroSeat, heroCards);
    if (h.street === 'preflop') return this.preflop(h, heroSeat, heroCards, prep, t0);
    let v3 = this.newSearchV3(h, heroSeat, heroCards, prep);
    if (typeof v3 !== 'string') {
      try { v3.run(samples); const d = this.decisionV3(h, heroSeat, prep, v3, false, t0, this.v3Sensitivity); this.onV3Search?.(v3, d); return d; }
      catch (e) { v3 = `version 3 failed (${(e as Error).message})`; }
    }
    const solver = this.newSolver(h, heroSeat, heroCards, prep);
    if (this.postflopEngine === 'v3') { solver.run(samples); const why = `version 3 not used: ${v3}; version 2 decided`; const d = this.postflopDecision(h, heroSeat, prep, solver, false, t0, why); d.basis.push(why); return d; }
    solver.run(samples);
    return this.postflopDecision(h, heroSeat, prep, solver, false, t0);
  }

  /**
   * Anytime decision: a valid action is available after the first batch and is
   * refined until the stopping rule or the deadline. Rejects with
   * DecisionCancelled when isCancelled() turns true.
   */
  async decide(h: HandState, heroSeat: number, heroCards: [CardId, CardId], opts: DecideOptions = {}): Promise<Decision> {
    const t0 = this.now();
    const prep = this.prepare(h, heroSeat, heroCards);
    if (h.street === 'preflop') {
      const d = this.preflop(h, heroSeat, heroCards, prep, t0);
      opts.onProgress?.(d);
      return d;
    }
    let v3 = this.newSearchV3(h, heroSeat, heroCards, prep);
    if (typeof v3 !== 'string') {
      // A failure inside version 3 falls back to version 2 for this decision (stated in the explanation); a
      // cancellation is passed on unchanged.
      try { return await this.decideV3(h, heroSeat, prep, v3, opts, t0); }
      catch (e) { if (e instanceof DecisionCancelled) throw e; v3 = `version 3 failed (${(e as Error).message})`; }
    }
    return this.decideV2(h, heroSeat, heroCards, prep, opts, t0, this.postflopEngine === 'v3' ? `version 3 not used: ${v3}; version 2 decided` : null);
  }

  /** Anytime loop for version 2 (and for version 1, and for version 3's fallback). */
  private async decideV2(h: HandState, heroSeat: number, heroCards: [CardId, CardId], prep: ReturnType<BotAgent['prepare']>, opts: DecideOptions, t0: number, fallbackNote: string | null): Promise<Decision> {
    const cancelled = opts.isCancelled ?? (() => false);
    const solver = this.newSolver(h, heroSeat, heroCards, prep);
    const fb = fallbackNote ?? undefined;
    const pot = potTotal(h);
    const budget = planBudget({
      timeRemainingMs: opts.timeRemainingMs ?? null, street: h.street, potBB: pot / h.bigBlind,
      effStackBB: effectiveStack(h, heroSeat) / h.bigBlind, opponents: prep.villains.length,
      candidates: solver.specs.length, stateConfidence: opts.stateConfidence ?? 1, jitterMs: opts.jitterMs,
    });
    if (opts.fixedSamples) {
      solver.run(opts.fixedSamples);
      const d = this.postflopDecision(h, heroSeat, prep, solver, false, t0, fb);
      if (fallbackNote) d.basis.push(fallbackNote);
      return d;
    }
    let first = true;
    for (;;) {
      solver.run(first ? Math.min(budget.batch, 120) : budget.batch);
      if (cancelled()) throw new DecisionCancelled();
      const res = solver.result();
      const stop = shouldStop(budget, { elapsedMs: this.now() - t0, samples: res.samples, separated: res.separated, evGap: res.evGap, evGapSe: res.evGapSe, potChips: pot });
      if (first || stop.stop) {
        const d = this.postflopDecision(h, heroSeat, prep, solver, !stop.stop, t0, fb);
        if (fallbackNote) d.basis.push(fallbackNote);
        if (stop.stop) { d.basis.push(`time: stopped after ${res.samples} samples (${stop.reason}); budget soft ${budget.softMs.toFixed(0)}ms / hard ${budget.hardMs.toFixed(0)}ms, importance ${budget.importance.toFixed(2)}`); opts.onProgress?.(d); return d; }
        opts.onProgress?.(d);
        first = false;
      }
      if (opts.yieldFn) { await opts.yieldFn(); if (cancelled()) throw new DecisionCancelled(); }
    }
  }

  /** Anytime loop for version 3: deals are added in batches; the tree is re-evaluated after each batch. */
  private async decideV3(h: HandState, heroSeat: number, prep: ReturnType<BotAgent['prepare']>, search: PostflopSearchV3, opts: DecideOptions, t0: number): Promise<Decision> {
    const cancelled = opts.isCancelled ?? (() => false);
    const pot = potTotal(h);
    if (opts.fixedSamples) { search.run(opts.fixedSamples); return this.decisionV3(h, heroSeat, prep, search, false, t0); }
    const budget = planBudget({
      timeRemainingMs: opts.timeRemainingMs ?? null, street: h.street, potBB: pot / h.bigBlind, effStackBB: effectiveStack(h, heroSeat) / h.bigBlind,
      opponents: 1, candidates: search.specs.length, stateConfidence: opts.stateConfidence ?? 1, jitterMs: opts.jitterMs,
    });
    // The tree is re-evaluated after every batch, so batches are larger than version 2's.
    const batch = Math.max(100, Math.min(400, budget.batch));
    let first = true;
    for (;;) {
      search.run(first ? 100 : batch);
      if (cancelled()) throw new DecisionCancelled();
      const res = search.result(2.5, false);
      const stop = shouldStop(budget, { elapsedMs: this.now() - t0, samples: res.samples, separated: res.separated, evGap: res.evGap, evGapSe: res.evGapSe, potChips: pot });
      if (stop.stop || res.samples >= 2400) {
        // The final evaluation (with the sensitivity scenarios) is the longest piece of synchronous work: give the
        // page a turn first, and drop it if the decision point changed meanwhile.
        if (opts.yieldFn) { await opts.yieldFn(); if (cancelled()) throw new DecisionCancelled(); }
        const d = this.decisionV3(h, heroSeat, prep, search, false, t0, this.v3Sensitivity);
        d.basis.push(`time: stopped after ${res.samples} deals (${stop.stop ? stop.reason : 'deal cap'}); budget soft ${budget.softMs.toFixed(0)}ms / hard ${budget.hardMs.toFixed(0)}ms`);
        opts.onProgress?.(d);
        return d;
      }
      if (first) { opts.onProgress?.(this.decisionV3(h, heroSeat, prep, search, true, t0, false)); first = false; }
      if (opts.yieldFn) { await opts.yieldFn(); if (cancelled()) throw new DecisionCancelled(); }
    }
  }
}
