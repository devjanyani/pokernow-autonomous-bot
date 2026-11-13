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
import { PostflopSolver } from './strategy/postflop';
import { Candidate, Decision } from './strategy/types';
import { buildVillains, FeatureCache } from './strategy/villains';
import {
  ActionInput, effectiveStack, HandState, legalActions, potTotal, tableCounts, validateAction,
} from './table/engine';
import { planBudget, shouldStop } from './time/budget';

export interface AgentOptions {
  /** 0 = ignore opponent statistics, 1 = full (still shrunk by sample size). */
  exploitWeight?: number;
  seed?: number;
  now?: () => number;
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

  constructor(opts: AgentOptions = {}) {
    this.exploitWeight = opts.exploitWeight ?? 1;
    this.seed = opts.seed ?? 1;
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
    const villains = buildVillains(h, heroSeat, heroCards, this.profiles, this.exploitWeight, this.cache);
    const rng = new Rng(hashSeed(this.seed, hashString(h.handId), h.events.length, heroSeat));
    return { la, counts, mode, villains, rng };
  }

  private finish(
    h: HandState, heroSeat: number, prep: ReturnType<BotAgent['prepare']>, candidates: Candidate[], chosen: number,
    extra: Pick<Decision, 'equity' | 'basis' | 'adjustments' | 'evGap' | 'evGapSe' | 'samples' | 'provisional'>, t0: number,
  ): Decision {
    let pick = candidates[chosen];
    let input: ActionInput = { seat: heroSeat, kind: pick.action, to: pick.to };
    const basis = extra.basis.slice();
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
    return {
      action: input.kind, to: input.to, label: pick.label, street: h.street, candidates,
      equity: extra.equity,
      ranges: prep.villains.map((v) => ({ seat: v.seat, name: v.name, line: v.line, summary: v.summary, basis: 'heuristic' as const })),
      adjustments, basis, uncertainty, evGap: extra.evGap, evGapSe: extra.evGapSe,
      counts: prep.counts, mode: prep.mode, samples: extra.samples, computeMs: this.now() - t0, provisional: extra.provisional,
    };
  }

  private preflop(h: HandState, heroSeat: number, heroCards: [CardId, CardId], prep: ReturnType<BotAgent['prepare']>, t0: number): Decision {
    const r = decidePreflop(h, heroSeat, heroCards, prep.villains, this.profiles, prep.rng, this.exploitWeight);
    return this.finish(h, heroSeat, prep, r.candidates, r.chosen, {
      equity: r.equity, basis: r.basis, adjustments: r.adjustments, evGap: r.evGap, evGapSe: r.evGapSe,
      samples: r.equity?.samples ?? 0, provisional: false,
    }, t0);
  }

  private postflopDecision(h: HandState, heroSeat: number, prep: ReturnType<BotAgent['prepare']>, solver: PostflopSolver, provisional: boolean, t0: number): Decision {
    const res = solver.result();
    // Sample the mix with a fixed draw so refinement does not flip-flop on the random number.
    let r = new Rng(hashSeed(this.seed, hashString(h.handId), h.events.length, 7)).next();
    let chosen = res.best;
    for (let i = 0; i < res.candidates.length; i++) { r -= res.candidates[i].freq; if (r < 0) { chosen = i; break; } }
    return this.finish(h, heroSeat, prep, res.candidates, chosen, {
      equity: res.equity,
      basis: [
        `computed: Monte Carlo EV of ${res.candidates.length} candidate actions over ${res.samples} joint deals vs ${prep.villains.length} opponent range(s)`,
        'heuristic: opponent ranges and responses from ranges/postflop-model.ts; realization factor on flop/turn',
      ],
      adjustments: [], evGap: res.evGap, evGapSe: res.evGapSe, samples: res.samples, provisional,
    }, t0);
  }

  /** Fully synchronous decision with a fixed sample count (simulator, tests). */
  decideSync(h: HandState, heroSeat: number, heroCards: [CardId, CardId], samples = 600): Decision {
    const t0 = this.now();
    const prep = this.prepare(h, heroSeat, heroCards);
    if (h.street === 'preflop') return this.preflop(h, heroSeat, heroCards, prep, t0);
    const solver = new PostflopSolver(h, heroSeat, heroCards, prep.villains, this.cache.get(h.board), prep.rng.int(1 << 30));
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
    const solver = new PostflopSolver(h, heroSeat, heroCards, prep.villains, this.cache.get(h.board), prep.rng.int(1 << 30));
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
