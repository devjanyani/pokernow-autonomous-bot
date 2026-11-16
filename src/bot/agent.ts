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
import { analyseSpot, describeSpot, SpotInfo } from './strategy/spot';
import { Candidate, Decision } from './strategy/types';
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
  engine?: 'v1' | 'v2';
  /**
   * BENCHMARK ONLY (sim/bot/strategy-diag.ts): choose the engine separately for preflop decisions and for
   * postflop decisions, to measure the two sets of changes apart. Each overrides `engine` for its streets.
   * "Preflop v2" = strategy-library lookups and chart-based opponent ranges while deciding preflop.
   * "Postflop v2" = the two-round engine with the range-aware opponent model (which includes chart-based
   * preflop ranges for the opponents) while deciding on the flop, turn and river.
   * The extension never sets these.
   */
  preflopEngine?: 'v1' | 'v2';
  postflopEngine?: 'v1' | 'v2';
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
  private readonly cache = new FeatureCache();
  private readonly exploitWeight: number;
  private readonly seed: number;
  private readonly now: () => number;
  private readonly engine: 'v1' | 'v2';
  private readonly preflopEngine: 'v1' | 'v2';
  private readonly postflopEngine: 'v1' | 'v2';

  constructor(opts: AgentOptions = {}) {
    this.exploitWeight = opts.exploitWeight ?? 1;
    this.seed = opts.seed ?? 1;
    this.engine = opts.engine ?? 'v2';
    this.preflopEngine = opts.preflopEngine ?? this.engine;
    this.postflopEngine = opts.postflopEngine ?? this.engine;
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** Record a completed hand in the opponent profiles (idempotent per hand id). */
  observeHand(h: HandState, reveals: Map<number, [CardId, CardId]> = new Map(), now = 0): string[] {
    return applyHandToProfiles(this.profiles, h, reveals, now);
  }

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
    extra: Pick<Decision, 'equity' | 'basis' | 'adjustments' | 'evGap' | 'evGapSe' | 'samples' | 'provisional'> & { lowConfidence?: boolean }, t0: number,
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
    return {
      action: input.kind, to: input.to, label: pick.label, street: h.street, candidates,
      equity: extra.equity,
      ranges: prep.villains.map((v) => ({ seat: v.seat, name: v.name, line: v.line, summary: v.summary, basis: prep.legacy ? 'heuristic' as const : (v.rangeBasis === 'solver' ? 'precomputed-chart' as const : v.rangeBasis), source: prep.legacy ? undefined : `${v.rangeSource}; postflop actions narrowed by the heuristic behaviour model` })),
      adjustments, basis, uncertainty, evGap: extra.evGap, evGapSe: extra.evGapSe,
      counts: prep.counts, mode: prep.mode, samples: extra.samples, computeMs: this.now() - t0, provisional: extra.provisional,
      ...(prep.legacy ? {} : { spot, confidence: lower ? 'lower' as const : 'normal' as const, engine: 'v2' as const }),
    };
  }

  private preflop(h: HandState, heroSeat: number, heroCards: [CardId, CardId], prep: ReturnType<BotAgent['prepare']>, t0: number): Decision {
    const r = decidePreflop(h, heroSeat, heroCards, prep.villains, this.profiles, prep.rng, this.exploitWeight, prep.legacy ? undefined : defaultLibrary());
    return this.finish(h, heroSeat, prep, r.candidates, r.chosen, {
      equity: r.equity, basis: r.basis, adjustments: r.adjustments, evGap: r.evGap, evGapSe: r.evGapSe,
      samples: r.equity?.samples ?? 0, provisional: false,
    }, t0);
  }

  private newSolver(h: HandState, heroSeat: number, heroCards: [CardId, CardId], prep: ReturnType<BotAgent['prepare']>): PostflopSolver | PostflopSolverV1 {
    const seed = prep.rng.int(1 << 30);
    return prep.legacy ? new PostflopSolverV1(h, heroSeat, heroCards, prep.villains, this.cache.get(h.board), seed)
      : new PostflopSolver(h, heroSeat, heroCards, prep.villains, this.cache.get(h.board), seed, prep.heroPerceived);
  }

  private postflopDecision(h: HandState, heroSeat: number, prep: ReturnType<BotAgent['prepare']>, solver: PostflopSolver | PostflopSolverV1, provisional: boolean, t0: number): Decision {
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
      equity: res.equity, basis, adjustments: [], evGap: res.evGap, evGapSe: res.evGapSe, samples: res.samples, provisional, lowConfidence,
    }, t0);
  }

  /** Fully synchronous decision with a fixed sample count (simulator, tests). */
  decideSync(h: HandState, heroSeat: number, heroCards: [CardId, CardId], samples = 600): Decision {
    const t0 = this.now();
    const prep = this.prepare(h, heroSeat, heroCards);
    if (h.street === 'preflop') return this.preflop(h, heroSeat, heroCards, prep, t0);
    const solver = this.newSolver(h, heroSeat, heroCards, prep);
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
    const cancelled = opts.isCancelled ?? (() => false);
    const prep = this.prepare(h, heroSeat, heroCards);
    if (h.street === 'preflop') {
      const d = this.preflop(h, heroSeat, heroCards, prep, t0);
      opts.onProgress?.(d);
      return d;
    }
    const solver = this.newSolver(h, heroSeat, heroCards, prep);
    const pot = potTotal(h);
    const budget = planBudget({
      timeRemainingMs: opts.timeRemainingMs ?? null, street: h.street, potBB: pot / h.bigBlind,
      effStackBB: effectiveStack(h, heroSeat) / h.bigBlind, opponents: prep.villains.length,
      candidates: solver.specs.length, stateConfidence: opts.stateConfidence ?? 1, jitterMs: opts.jitterMs,
    });
    if (opts.fixedSamples) {
      solver.run(opts.fixedSamples);
      return this.postflopDecision(h, heroSeat, prep, solver, false, t0);
    }
    let first = true;
    for (;;) {
      solver.run(first ? Math.min(budget.batch, 120) : budget.batch);
      if (cancelled()) throw new DecisionCancelled();
      const res = solver.result();
      const stop = shouldStop(budget, { elapsedMs: this.now() - t0, samples: res.samples, separated: res.separated, evGap: res.evGap, evGapSe: res.evGapSe, potChips: pot });
      if (first || stop.stop) {
        const d = this.postflopDecision(h, heroSeat, prep, solver, !stop.stop, t0);
        if (stop.stop) { d.basis.push(`time: stopped after ${res.samples} samples (${stop.reason}); budget soft ${budget.softMs.toFixed(0)}ms / hard ${budget.hardMs.toFixed(0)}ms, importance ${budget.importance.toFixed(2)}`); opts.onProgress?.(d); return d; }
        opts.onProgress?.(d);
        first = false;
      }
      if (opts.yieldFn) { await opts.yieldFn(); if (cancelled()) throw new DecisionCancelled(); }
    }
  }
}
