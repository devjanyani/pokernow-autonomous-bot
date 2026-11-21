// ============================================================
// Live controller: observe -> reconstruct -> decide -> (optionally) act.
//
// Runs in the content script, but has no direct DOM or chrome.* dependency:
// everything external comes in through ControllerDeps, so the whole loop is
// exercised in tests with a simulated table.
//
// Separation of duties:
//   observer (deps.observe)        reads the page
//   HandTracker                    validated game state, observed vs predicted actor
//   BotAgent                       strategy only, never touches the page
//   GuardedExecutor + deps.driver  the only path to a click
//   FrameRecorder                  local diagnostic recording (debug bundle)
//
// Recommendation lifecycle. A recommendation belongs to ONE decision point,
// identified by hand id, street and state version (number of reconstructed
// events). It is requested every time Hero's turn is both shown by the table
// and predicted by the engine with no open blocker, including a second or
// third time on the same street. It is dropped the moment the decision point
// changes or Hero's turn ends; nothing computed for an earlier state is shown.
// When Hero's turn is shown but the state cannot be trusted, the reason is
// displayed and logged instead of a blank panel.
// ============================================================

import { CardId, cardStr } from '../cards';
import { BotAgent, DecisionCancelled } from '../agent';
import { GuardedExecutor, TableDriver } from '../adapter/executor';
import { TableObs } from '../adapter/observation';
import { CompletedHand, HandTracker, TrackerState } from '../adapter/tracker';
import { FrameDecision, FrameRecorder } from '../diag/recorder';
import { buildTimeline } from '../diag/timeline';
import { PlayerProfile, sanitizeProfile } from '../opponents/profile';
import { Decision } from '../strategy/types';
import { loadV3Artifacts, V3Artifacts } from '../strategy/v3/artifacts';
import { cloneHand, effectiveStack, HandState, legalActions, potTotal, tableCounts } from '../table/engine';
import { SAFETY_MARGIN_MS } from '../time/budget';
import {
  BotMessage, DecisionRecord, executionStatus, Indicator, LiveState, mayAct, Readiness, Recommendation, RecommendationContext, ScheduleView, Settings, ShadowComparison, StrategyView, toHandRecord,
} from './records';
import { ActionScheduler, TimingPolicy } from './scheduler';

/** The fitted version 3 tables, validated once per page (strategy/v3/artifacts.ts). */
let v3Artifacts: V3Artifacts | null = null;
export const packagedV3Artifacts = (): V3Artifacts => (v3Artifacts ??= loadV3Artifacts());

/**
 * The agent for a strategy choice. Version 3 gets the packaged fitted tables that passed validation, with the spot
 * checks on (a table is applied only where its data covers the spot). Versions 1 and 2 are built exactly as before.
 */
export function agentFor(engine: Settings['strategyEngine'], exploitWeight: number, seed: number, now: () => number, artifacts: V3Artifacts = packagedV3Artifacts()): BotAgent {
  if (engine !== 'v3') return new BotAgent({ exploitWeight, seed, now, engine });
  return new BotAgent({ exploitWeight, seed, now, engine: 'v3', v3Population: artifacts.population, v3RiverRange: artifacts.riverRange, v3SpotChecks: true, v3ArtifactStatus: artifacts.status });
}

export interface ControllerDeps {
  observe(): TableObs;
  health(): Record<string, boolean>;
  driver: TableDriver;
  send(msg: BotMessage): void;
  loadProfiles(ids: string[]): Promise<PlayerProfile[]>;
  now(): number;
  sleep(ms: number): Promise<void>;
  yieldFn(): Promise<void>;
  random(): number;
  render(live: LiveState): void;
}

export const MSG = {
  heroAllIn: 'Hero all-in — no further betting decisions.',
  heroFolded: 'Hero folded — waiting for next hand.',
  waitingOpponent: 'Waiting for opponent.',
  unavailable: 'Decision unavailable — state reconciliation required.',
};

const REQUIRED_ELEMENTS = ['seats', 'hero', 'dealer', 'blinds'];

export class LiveController {
  readonly tracker = new HandTracker();
  agent: BotAgent;
  readonly executor: GuardedExecutor;
  readonly recorder: FrameRecorder;
  private settings: Settings;
  private lastObs: TableObs | null = null;
  private decision: Decision | null = null;
  private decisionKey: string | null = null;
  private deciding = false;
  private turnKey: string | null = null;
  private turnStart = 0;
  private deadline: number | null = null;
  private status = 'starting';
  private rec: Recommendation = { state: 'none', reason: 'starting', context: null };
  private lastExecution: LiveState['lastExecution'] = null;
  private readonly requested = new Set<string>();
  private readonly fallbackDone = new Set<string>();
  private readonly suppressedLogged = new Set<string>();
  private lastPublish = 0;
  private lastFlush = 0;
  private pendingCompleted: CompletedHand[] = [];
  /** Shadow comparison (diagnostic only): a version 3 agent sharing the profiles, never used to act. */
  private shadowAgent: BotAgent | null = null;
  private shadow: ShadowComparison | null = null;
  private readonly artifacts: V3Artifacts;
  /** Authorised-play timing: one plan per decision opportunity, at most one pending action. */
  readonly scheduler: ActionScheduler;
  /** Incremented whenever the decision in flight is invalidated, so an older computation or wait can never act. */
  private gen = 0;
  /** A frame without Hero's turn has been seen on this page (false right after a load or refresh). */
  private sawOtherTurn = false;

  constructor(private readonly deps: ControllerDeps, settings: Settings, private readonly seed = 1, artifacts?: V3Artifacts) {
    this.settings = settings;
    this.artifacts = artifacts ?? packagedV3Artifacts();
    this.agent = agentFor(settings.strategyEngine, settings.exploitWeight, seed, deps.now, this.artifacts);
    this.syncShadow();
    this.executor = new GuardedExecutor(deps.driver, () => this.read(), { minConfidence: settings.minConfidence, sleep: deps.sleep, now: deps.now });
    this.recorder = new FrameRecorder(`${Date.now().toString(36)}-${Math.floor(deps.random() * 1e9).toString(36)}`);
    this.scheduler = new ActionScheduler(deps.now, deps.random);
  }

  private policy(): TimingPolicy {
    const s = this.settings;
    return { mode: s.timingMode, minDelayMs: s.minDelayMs, maxDelayMs: s.maxDelayMs, deadlineMarginMs: s.deadlineMarginMs, assumedClockMs: s.assumedClockMs };
  }

  /** Cancel whatever is pending (page hidden, controller replaced). Later ticks plan again from the table. */
  cancelPending(reason: string): void { this.clearDecision(reason); this.publish(true); }

  /** The shadow agent exists only while version 2 is selected and the comparison is switched on. */
  private syncShadow(): void {
    const want = this.settings.shadowV3 && this.settings.strategyEngine === 'v2';
    if (want && !this.shadowAgent) this.shadowAgent = agentFor('v3', this.settings.exploitWeight, this.seed, this.deps.now, this.artifacts);
    if (!want) { this.shadowAgent = null; this.shadow = null; }
  }

  updateSettings(s: Settings): void {
    const old = this.settings;
    const table = this.lastObs?.tableId ?? 'unknown';
    const why = s.estop && !old.estop ? 'emergency stop'
      : s.mode !== old.mode ? `mode changed to ${s.mode}`
        : mayAct(old, table) && !mayAct(s, table) ? `execution no longer permitted (${executionStatus(s, table).reason})`
          : s.strategyEngine !== old.strategyEngine ? `strategy changed from ${old.strategyEngine} to ${s.strategyEngine}`
            : s.timingMode !== old.timingMode ? `timing mode changed to ${s.timingMode}`
              : 'settings changed';
    const timingChanged = s.timingMode !== old.timingMode || s.minDelayMs !== old.minDelayMs || s.maxDelayMs !== old.maxDelayMs
      || s.deadlineMarginMs !== old.deadlineMarginMs || s.assumedClockMs !== old.assumedClockMs;
    const exploitChanged = s.exploitWeight !== this.settings.exploitWeight || s.strategyEngine !== this.settings.strategyEngine;
    const shadowChanged = s.shadowV3 !== this.settings.shadowV3 || exploitChanged;
    this.settings = s;
    if (exploitChanged) {
      // Switching engines keeps everything learned about the opponents; only the strategy changes.
      const old = this.agent;
      this.agent = agentFor(s.strategyEngine, s.exploitWeight, this.seed, this.deps.now, this.artifacts);
      for (const [k, v] of old.profiles) this.agent.profiles.set(k, v);
      for (const [k, v] of old.v3Calibration) this.agent.v3Calibration.set(k, v);
    }
    if (shadowChanged) { this.shadowAgent = null; this.syncShadow(); }
    if (s.estop || s.mode !== 'autonomous') this.executor.stop();
    // Any settings change invalidates the decision in flight: the next tick decides again under the
    // new mode (for example recommend -> autonomous while it is Hero's turn). The executor's own
    // used-decision-point record still prevents a second click for a point already acted on.
    this.clearDecision(why);
    // New timing: the opportunity keeps its start and deadline and gets a delay drawn under the new policy.
    if (timingChanged) this.scheduler.replan(this.policy());
    this.publish(true);
  }

  /** Read the table once and fold the result into the tracker. Used by tick() and by the executor. */
  private read(): { obs: TableObs; state: HandTracker['state'] } {
    const obs = this.deps.observe();
    this.lastObs = obs;
    this.pendingCompleted.push(...this.tracker.ingest(obs));
    return { obs, state: this.tracker.state };
  }

  private diag(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const tableId = this.lastObs?.tableId;
    this.deps.send({ type: 'bot/diag', record: { ts: Date.now(), level, source: 'controller', message, data, ...(tableId && tableId !== 'unknown' ? { tableId } : {}) } });
  }

  private handleCompleted(tableId: string): void {
    // Results of earlier hands checked against the stacks the next hand started with.
    for (const check of this.tracker.takeResultChecks()) {
      this.deps.send({ type: 'bot/handCheck', check });
      if (check.status === 'awarded-differently' || check.status === 'unexplained') this.diag('warn', `hand ${check.handId}: ${check.note}`);
    }
    for (const c of this.pendingCompleted.splice(0)) {
      let profiles: PlayerProfile[] = [];
      if (c.valid) {
        this.shadowAgent?.observeV3Responses(c.hand);
        const ids = this.agent.observeHand(c.hand, c.reveals, Date.now());
        profiles = ids.map((id) => this.agent.profiles.get(id)!).filter((p) => !p.playerId.startsWith('ambiguous:'));
      } else this.diag('warn', `hand ${c.hand.handId} not used for profiles (${c.observedToEnd ? 'reconstruction invalid or uncertain' : 'ending not observed'})`);
      this.deps.send({ type: 'bot/hand', hand: toHandRecord(c, tableId, Date.now()), profiles });
    }
  }

  private requestProfiles(): void {
    const h = this.tracker.state.hand;
    if (!h) return;
    const ids = h.seats.map((s) => s.playerId).filter((id) => !id.startsWith('ambiguous:') && !this.requested.has(id));
    if (!ids.length) return;
    for (const id of ids) this.requested.add(id);
    this.deps.loadProfiles(ids).then((stored) => {
      for (const p of stored) {
        const have = this.agent.profiles.get(p.playerId);
        if (!have || have.hands < p.hands) this.agent.profiles.set(p.playerId, sanitizeProfile(p));
      }
    }).catch((e) => this.diag('error', `profile load failed: ${(e as Error).message}`));
  }

  /**
   * The user deleted these profiles on the dashboard: drop the copies held here, so the next hand starts them
   * from nothing instead of writing the old totals back.
   */
  forgetProfiles(ids: string[]): void {
    for (const id of ids) { this.agent.profiles.delete(id); this.requested.delete(id); }
  }

  /** Drop everything that belongs to an earlier decision point, including a pending action (with the reason). */
  private clearDecision(reason = 'the decision point changed'): void {
    if (this.decisionKey !== null || this.scheduler.pending) this.gen++;
    this.scheduler.cancel(reason);
    this.decisionKey = null; this.decision = null;
  }

  /** Hero's turn is shown but no recommendation can be given: say why, on screen and in the log (once per state). */
  private suppress(obs: TableObs, state: TrackerState, why: string, now: number): void {
    this.clearDecision(`table state not confirmed: ${why}`);
    this.rec = { state: 'blocked', reason: why, context: null };
    this.status = `${MSG.unavailable} ${why}`;
    const k = `${state.hand?.handId ?? state.handsSeen}|${state.eventCount}|${why}`;
    if (state.settled && !this.suppressedLogged.has(k)) {
      this.suppressedLogged.add(k);
      if (this.suppressedLogged.size > 300) this.suppressedLogged.clear();
      this.diag('warn', `recommendation suppressed on Hero's turn: ${why}`, {
        handId: state.hand?.handId ?? null, street: state.hand?.street ?? null, version: state.eventCount,
        observedActor: state.observedActor, predictedActor: state.predictedActor, blockers: state.blockers, controls: obs.controls,
      });
    }
    this.untrustedTurn(obs, now);
  }

  /** The page is mid-update (first sight of a change that does not add up yet): wait for a stable read, show nothing stale. */
  private settling(state: TrackerState): void {
    this.clearDecision('the page is mid-update');
    this.status = 'Reading the table (waiting for a stable snapshot).';
    this.rec = { state: 'none', reason: `${this.status} ${state.blockers[0] ?? (state.actorLagging ? 'the page still shows the previous turn' : '')}`.trim(), context: null };
  }

  /** Not Hero's decision: one explicit status per situation (never a blank panel). */
  private idle(state: TrackerState): void {
    this.clearDecision('it is no longer Hero\'s turn on the table'); this.turnKey = null; this.deadline = null;
    const h = state.hand;
    let s: string;
    if (state.unsupported) s = 'Unsupported game: observing only.';
    else if (!h) s = state.phase === 'initialising' ? `Hand starting (${state.waitingReason ?? 'reading the table'}).` : `Waiting for hand (${state.waitingReason ?? 'no hand in progress'}).`;
    else if (!state.valid) s = 'Hand state invalid: waiting for the next hand.';
    else {
      switch (state.heroStatus) {
        case 'folded': s = MSG.heroFolded; break;
        case 'all-in': s = MSG.heroAllIn; break;
        case 'not-dealt-in': s = 'Hero not dealt in — observing.'; break;
        case 'hand-over': s = 'Hand complete — waiting for next hand.'; break;
        case 'showdown': s = 'Showdown.'; break;
        case 'awaiting-board': s = 'Betting round complete — waiting for the next card.'; break;
        case 'to-act': s = 'Engine expects Hero to act; waiting for the table to show Hero\'s turn.'; break;
        default: {
          const p = h.seats.find((x) => x.seat === h.toAct);
          s = p ? `${MSG.waitingOpponent} (${p.pos?.label ?? `seat ${p.seat}`} ${p.name})` : MSG.waitingOpponent;
        }
      }
    }
    this.status = s;
    this.rec = { state: 'none', reason: s, context: null };
  }

  /** One pass of the loop. Cheap and synchronous; long work is started asynchronously. */
  tick(): void {
    let obs: TableObs;
    try { obs = this.read().obs; } catch (e) {
      this.status = `read error: ${(e as Error).message}`;
      this.diag('error', this.status);
      return;
    }
    const state = this.tracker.state;
    this.handleCompleted(obs.tableId);
    this.requestProfiles();
    this.executor.armed = mayAct(this.settings, obs.tableId);
    if (!obs.heroToAct) this.sawOtherTurn = true;
    const h = state.hand;
    const now = this.deps.now();
    const predictedHero = !!h && state.heroSeat !== null && h.toAct === state.heroSeat;

    if (!obs.heroToAct) this.idle(state);
    else if (state.unsupported) this.suppress(obs, state, 'Unsupported game type.', now);
    else if (!h) this.suppress(obs, state, `No hand is being tracked (${state.waitingReason ?? 'unknown'}).`, now);
    else if (!state.valid) this.suppress(obs, state, `The hand could not be reconstructed (${state.issues.filter((i) => i.startsWith('INVALID')).pop() ?? 'invalid'}).`, now);
    else if ((state.blockers.length && !state.settled) || (state.actorLagging && !predictedHero)) this.settling(state);
    else if (state.blockers.length) this.suppress(obs, state, state.blockers[0], now);
    else if (!predictedHero) this.suppress(obs, state, `Table shows Hero's turn, engine expects ${h.toAct === null ? 'no further action' : `seat ${h.toAct}`}.`, now);
    else if (!state.heroCards) this.suppress(obs, state, 'Hero\'s cards could not be read.', now);
    else if (state.confidence < this.settings.minConfidence) this.suppress(obs, state, `Too many open warnings (${state.warnings.slice(0, 2).join('; ')}).`, now);
    else this.heroTurn(obs, state, now);

    this.record(obs, state);
    this.publish();
  }

  /** Hero's turn, shown by the table and confirmed by the engine. */
  private heroTurn(obs: TableObs, state: TrackerState, now: number): void {
    const h = state.hand!;
    const key = `${h.handId}|${h.street}|${state.eventCount}`;
    if (this.turnKey !== key) {
      // A new decision point (new hand, new street, or the action came back to Hero): everything older is stale.
      const prev = this.turnKey?.split('|');
      const change = !prev || prev.length < 3 ? 'a new decision point' : prev[0] !== h.handId ? 'the hand changed' : prev[1] !== h.street ? 'the street changed' : `new action at the table (state version ${prev[2]} -> ${state.eventCount})`;
      this.turnKey = key; this.turnStart = now; this.clearDecision(change);
      this.deadline = now + (obs.timeRemainingMs ?? this.settings.assumedClockMs);
    } else if (obs.timeRemainingMs !== null) this.deadline = now + obs.timeRemainingMs;
    const la = legalActions(h)!;
    const context: RecommendationContext = {
      key, handId: h.handId, street: h.street, version: state.eventCount, heroSeat: state.heroSeat!, toCall: la.callAmount, canCheck: la.canCheck,
      canRaise: la.canRaise, minRaiseTo: la.minRaiseTo, maxRaiseTo: la.maxRaiseTo, opponents: tableCounts(h, state.heroSeat!).opponentsContesting,
    };
    if (this.settings.mode === 'manual') {
      this.status = 'Manual mode: observing only.';
      this.rec = { state: 'off', reason: this.status, context };
      return;
    }
    // Authorised play: the opportunity's timing plan (created once, its delay drawn before any recommendation).
    if (mayAct(this.settings, obs.tableId)) {
      this.scheduler.plan(key, this.turnStart, { at: this.deadline, observed: obs.timeRemainingMs !== null }, this.policy(), !this.sawOtherTurn);
    }
    if (this.decisionKey !== key) {
      this.decision = null;
      this.rec = { state: 'thinking', reason: null, context };
      this.status = 'thinking';
      if (!this.deciding) void this.decide(key, context);
      return;
    }
    this.rec = { state: this.decision && !this.decision.provisional ? 'ready' : 'thinking', reason: null, context };
  }

  /** Hero must act but the state is not trusted: optionally check/fold when the clock is nearly out (autonomous only). */
  private untrustedTurn(obs: TableObs, now: number): void {
    const fk = `${this.tracker.state.handsSeen}|${obs.board.length}|${obs.seats.find((s) => s.isHero)?.bet ?? 0}`;
    if (this.turnKey !== `untrusted|${fk}`) { this.turnKey = `untrusted|${fk}`; this.turnStart = now; this.deadline = now + (obs.timeRemainingMs ?? this.settings.assumedClockMs); }
    const left = (this.deadline ?? now) - now;
    if (!mayAct(this.settings, obs.tableId) || this.settings.timeoutAction !== 'check-fold' || left > SAFETY_MARGIN_MS + 500 || this.fallbackDone.has(fk)) return;
    this.fallbackDone.add(fk);
    if (this.fallbackDone.size > 200) this.fallbackDone.clear();
    const kind = obs.controls.check ? 'check' : obs.controls.fold ? 'fold' : null;
    if (!kind) return;
    this.diag('warn', `clock nearly out with untrusted state: safe ${kind}`);
    void this.deps.driver.click(kind).then((ok) => { this.lastExecution = { status: ok ? 'safe-fallback' : 'failed', reason: 'untrusted state at deadline', ms: 0, action: kind }; });
  }

  private async decide(key: string, context: RecommendationContext): Promise<void> {
    const state = this.tracker.state;
    const h = cloneHand(state.hand!);
    const heroSeat = state.heroSeat!, heroCards = state.heroCards!;
    const obs = this.lastObs!;
    this.decisionKey = key;
    this.deciding = true;
    const gen = ++this.gen;
    const cancelled = () => this.gen !== gen || this.decisionKey !== key;
    const t0 = this.deps.now();
    let d: Decision;
    const remainingOf = () => (this.deadline ?? this.deps.now() + this.settings.assumedClockMs) - this.deps.now();
    try {
      // Time available to the engine: the clock minus the think-time floor we may still add.
      const remaining = remainingOf();
      d = await this.agent.decide(h, heroSeat, heroCards, {
        timeRemainingMs: remaining, stateConfidence: state.confidence, isCancelled: cancelled, yieldFn: this.deps.yieldFn,
        onProgress: (p) => { if (!cancelled()) { this.decision = p; this.publish(); } },
      });
    } catch (e) {
      this.deciding = false;
      if (!(e instanceof DecisionCancelled)) { this.status = `engine error: ${(e as Error).message}`; this.diag('error', this.status); }
      return;
    }
    this.deciding = false;
    if (cancelled()) return;
    this.decision = d;
    this.rec = { state: 'ready', reason: null, context };
    const record: DecisionRecord = {
      handId: h.handId, tableId: obs.tableId, ts: Date.now(), eventCount: h.events.length, heroCards: heroCards.map(cardStr), board: h.board.map(cardStr),
      pot: potTotal(h), decision: d, execution: null, context,
    };
    if (!mayAct(this.settings, obs.tableId)) {
      this.status = `recommendation: ${d.label}`;
      this.deps.send({ type: 'bot/decision', record });
      this.publish(true);
      // Started only now, so it never delays the recommendation; the next decision point cancels it.
      if (this.shadowAgent && h.street !== 'preflop') void this.shadowDecide(key, h, heroSeat, heroCards, d, remainingOf());
      return;
    }
    // Scheduled execution (scheduler.ts): due at the opportunity's start plus its drawn delay, computation included,
    // never later than the deadline minus the safety margin.
    const plan = this.scheduler.get(key) ?? this.scheduler.plan(key, this.turnStart, { at: this.deadline, observed: obs.timeRemainingMs !== null }, this.policy(), !this.sawOtherTurn);
    const fb = d.strategy?.fallback ? ` (${d.strategy.requested} -> ${d.strategy.used} fallback)` : '';
    const pending = this.scheduler.arm({ key, label: d.label, decidedBy: d.strategy?.used ?? this.settings.strategyEngine, fallback: d.strategy?.fallback ?? null, computeMs: this.deps.now() - Math.min(t0, plan.startedAt) });
    if (!pending) return;
    if (pending.plannedWaitMs > 0) { this.status = `acting in ${(pending.plannedWaitMs / 1000).toFixed(1)}s: ${d.label}${fb}`; this.publish(true); }
    if (plan.conflict) this.diag('warn', `deadline conflict: ${plan.conflict}`, { handId: h.handId, street: h.street, version: h.events.length });
    const due = await this.scheduler.waitUntilDue(key, this.deps.sleep, cancelled);
    if (!due || cancelled()) { this.scheduler.cancel('the decision point changed'); return; }
    // Immediately before the click: the permission again (the executor then re-reads and re-validates the table).
    this.executor.armed = mayAct(this.settings, obs.tableId);
    if (!this.executor.armed) { this.scheduler.cancel(`execution no longer permitted (${executionStatus(this.settings, obs.tableId).reason})`); this.publish(true); return; }
    this.scheduler.firing(key);
    const req = { action: d.action, to: d.to, handId: h.handId, street: h.street, eventCount: h.events.length };
    let out = await this.executor.execute(req);
    if (out.status === 'failed' && (d.action === 'bet' || d.action === 'raise')) {
      // The bet could not be entered and nothing was submitted: take the best passive action instead.
      const la = legalActions(h)!;
      const call = d.candidates.find((c) => c.action === 'call');
      const alt = la.canCheck ? 'check' : call && (call.ev ?? -1) > 0 ? 'call' : 'fold';
      this.diag('warn', `bet entry failed (${out.reason}); falling back to ${alt}`);
      out = await this.executor.execute({ ...req, action: alt, to: undefined });
    }
    this.scheduler.fired(key, `${d.label}${fb}`, `${out.status}: ${out.reason}`);
    const fired = this.scheduler.lastFired!;
    this.lastExecution = { status: out.status, reason: out.reason, ms: out.ms, action: `${d.label}${fb}` };
    record.execution = {
      status: out.status, reason: out.reason, ms: out.ms,
      timing: { targetDelayMs: plan.targetDelayMs, actualDelayMs: fired.delayMs, computeMs: fired.computeMs, waitedMs: fired.waitedMs, deadlineSource: plan.deadlineSource, conflict: plan.conflict, capped: plan.capped },
    };
    this.status = `${out.status}: ${d.label}${fb} (${out.reason})`;
    if (out.status !== 'accepted') this.diag(out.status === 'rejected' ? 'info' : 'warn', `execution ${out.status}: ${out.reason}`, req);
    this.deps.send({ type: 'bot/decision', record });
    this.publish(true);
    if (this.shadowAgent && h.street !== 'preflop') void this.shadowDecide(key, h, heroSeat, heroCards, d, remainingOf());
  }

  /**
   * Shadow comparison, diagnostic only: version 3's recommendation for the decision point version 2 just decided.
   * Runs after version 2's recommendation is out (and after any click), yields to the page between batches, and is
   * dropped the moment the decision point changes. Its result is shown, never executed, never stored as a decision.
   */
  private async shadowDecide(key: string, h: HandState, heroSeat: number, heroCards: [CardId, CardId], v2: Decision, remainingMs: number): Promise<void> {
    const agent = this.shadowAgent;
    if (!agent) return;
    const cancelled = () => this.decisionKey !== key || this.shadowAgent !== agent;
    const evOf = (d: Decision) => d.candidates.find((c) => c.action === d.action && c.to === d.to)?.ev ?? null;
    const base: ShadowComparison = { key, v2: { label: v2.label, action: v2.action, to: v2.to ?? null, ev: evOf(v2) }, v3: null, note: 'version 3 computing', sameAction: null, sizeDiffers: null };
    this.shadow = base;
    this.publish(true);
    // The shadow agent reads the same opponent profiles (it never writes them).
    for (const [k, v] of this.agent.profiles) agent.profiles.set(k, v);
    try {
      const d = await agent.decide(h, heroSeat, heroCards, { timeRemainingMs: Math.max(1000, remainingMs), isCancelled: cancelled, yieldFn: this.deps.yieldFn });
      if (cancelled()) return;
      const same = d.action === v2.action;
      this.shadow = {
        ...base, note: null, sameAction: same, sizeDiffers: same && (d.action === 'bet' || d.action === 'raise') ? Math.abs((d.to ?? 0) - (v2.to ?? 0)) > 1e-9 : false,
        v3: { label: d.label, action: d.action, to: d.to ?? null, ev: evOf(d), used: d.strategy?.used ?? 'v3', fallback: d.strategy?.fallback ?? null, computeMs: d.computeMs },
      };
      this.diag('info', `shadow comparison: version 2 ${v2.label}, version 3 ${d.label}${d.strategy?.fallback ? ` (version 3 fell back: ${d.strategy.fallback})` : ''}`, { handId: h.handId, street: h.street, version: h.events.length, sameAction: same });
    } catch (e) {
      if (cancelled()) return;
      this.shadow = { ...base, note: e instanceof DecisionCancelled ? 'cancelled: the decision point changed' : `version 3 error: ${(e as Error).message}` };
    }
    this.publish(true);
  }

  /** What the dashboard says about the selected strategy. */
  private strategyView(): StrategyView {
    const s = this.settings;
    return {
      selected: s.strategyEngine, experimental: s.strategyEngine === 'v3', recommendOnly: s.strategyEngine === 'v3' && !s.v3ExecutionOptIn,
      v3Execution: s.strategyEngine === 'v3' && s.v3ExecutionOptIn, shadowV3: s.shadowV3 && s.strategyEngine === 'v2',
      artifacts: s.strategyEngine === 'v3' || s.shadowV3 ? this.artifacts.status.map((a) => ({ ...a })) : [],
    };
  }

  /** The recommendation as it may be shown right now: only for the current decision point. */
  private shownDecision(): Decision | null {
    return (this.rec.state === 'ready' || this.rec.state === 'thinking') && this.rec.context && this.decisionKey === this.rec.context.key ? this.decision : null;
  }

  private record(obs: TableObs, state: TrackerState): void {
    if (!this.settings.recordDiagnostics) return;
    const d = this.shownDecision();
    const fd: FrameDecision = { state: this.rec.state, reason: this.rec.reason, key: this.rec.context?.key ?? null, label: d?.label ?? null, action: d?.action ?? null, to: d?.to ?? null };
    this.recorder.record(obs, state, fd);
    const now = this.deps.now();
    if (this.recorder.pendingCount >= 25 || (this.recorder.pendingCount > 0 && now - this.lastFlush > 1500)) this.flush();
  }

  /** Hand recorded frames to storage (also called when the page is being hidden). */
  flush(): void {
    this.lastFlush = this.deps.now();
    for (let i = 0; i < 8 && this.recorder.pendingCount > 0; i++) this.deps.send({ type: 'bot/frames', frames: this.recorder.drain(30) });
  }

  private publish(force = false): void {
    const now = this.deps.now();
    if (!force && now - this.lastPublish < 250) return;
    this.lastPublish = now;
    const live = this.snapshot();
    this.deps.render(live);
    this.deps.send({ type: 'bot/live', live });
  }

  private readiness(obs: TableObs | null, st: TrackerState, d: Decision | null): Readiness {
    const health = this.deps.health();
    const missing = Object.entries(health).filter(([, ok]) => !ok).map(([k]) => k);
    const missingRequired = missing.filter((k) => REQUIRED_ELEMENTS.includes(k));
    const optional = missing.filter((k) => !REQUIRED_ELEMENTS.includes(k));
    const observation: Indicator = !obs ? { level: 'na', detail: 'no read yet' }
      : missingRequired.length ? { level: 'bad', detail: `required elements not found: ${missingRequired.join(', ')}` }
        : obs.problems.length ? { level: 'warn', detail: obs.problems.slice(0, 3).join('; ') }
          : { level: 'ok', detail: optional.length ? `all required elements read (not shown right now or not found: ${optional.join(', ')}; none of these blocks a decision)` : 'all elements read' };
    const h = st.hand;
    const consistency: Indicator = !h ? { level: 'na', detail: st.waitingReason ?? 'no hand' }
      : st.consistency === 'invalid' ? { level: 'bad', detail: st.issues.filter((i) => i.startsWith('INVALID')).pop() ?? 'invalid' }
        : st.consistency === 'reconciliation-required' ? { level: 'bad', detail: `reconciliation required: ${st.blockers.join(' | ')}` }
          : st.consistency === 'warnings' ? { level: 'warn', detail: st.warnings.join(' | ') }
            : { level: 'ok', detail: 'stacks, bets, pot and board agree with the reconstruction' };
    const nameOf = (seat: number | null) => { const p = h?.seats.find((s) => s.seat === seat); return seat === null ? 'nobody' : p ? `seat ${seat} (${p.pos?.label ?? '?'} ${p.name})` : `seat ${seat}`; };
    const turn: Indicator = st.turnStatus === 'agree' ? { level: 'ok', detail: `table and engine agree: ${nameOf(st.predictedActor)}` }
      : st.turnStatus === 'disagree' ? { level: 'bad', detail: `table shows ${nameOf(st.observedActor)}, engine expects ${nameOf(st.predictedActor)}` }
        : st.turnStatus === 'unobserved' ? { level: 'warn', detail: `engine expects ${nameOf(st.predictedActor)}; the table shows no acting seat (not verified)` }
          : { level: 'na', detail: 'nobody to act' };
    const legal: Indicator = st.legal.status === 'match' ? { level: 'ok', detail: `buttons match the engine (${st.legal.actions?.canCheck ? 'check' : `call ${st.legal.actions?.callAmount}`}${st.legal.actions?.canRaise ? `, raise ${st.legal.actions.minRaiseTo}–${st.legal.actions.maxRaiseTo}` : ''})` }
      : st.legal.status === 'mismatch' ? { level: 'bad', detail: st.legal.detail ?? 'buttons disagree with the engine' }
        : st.legal.status === 'unverified' ? { level: 'warn', detail: st.legal.detail ?? 'not verified' }
          : { level: 'na', detail: 'not Hero\'s turn' };
    const decision: Indicator = this.rec.state === 'ready' ? { level: 'ok', detail: `recommendation for state version ${this.rec.context?.version}` }
      : this.rec.state === 'thinking' ? { level: 'ok', detail: 'computing' }
        : this.rec.state === 'blocked' ? { level: 'bad', detail: this.rec.reason ?? 'blocked' }
          : { level: 'na', detail: this.rec.reason ?? '' };
    const strategy: Indicator = d ? { level: /^clear|^moderate/.test(d.uncertainty) ? 'ok' : 'warn', detail: d.uncertainty } : { level: 'na', detail: 'no recommendation' };
    return { observation, consistency, turn, legal, decision, strategy };
  }

  snapshot(): LiveState {
    const obs = this.lastObs;
    const st = this.tracker.state;
    const h = st.hand;
    const tableId = obs?.tableId ?? 'unknown';
    const heroSeatState = h && st.heroSeat !== null ? h.seats.find((s) => s.seat === st.heroSeat) : undefined;
    const decision = this.shownDecision();
    return {
      ts: Date.now(), tableId, mode: this.settings.mode, acting: mayAct(this.settings, tableId), estop: this.settings.estop, status: this.status,
      observation: { health: this.deps.health(), problems: obs?.problems ?? [], heroToAct: obs?.heroToAct ?? false, timeRemainingMs: obs?.timeRemainingMs ?? null },
      tracker: {
        valid: st.valid, confidence: st.confidence, unsupported: st.unsupported, issues: st.issues, waitingReason: st.waitingReason, handsSeen: st.handsSeen,
        phase: st.phase, consistency: st.consistency, settled: st.settled, blockers: st.blockers, warnings: st.warnings,
        observedActor: st.observedActor, predictedActor: st.predictedActor, turnStatus: st.turnStatus, heroStatus: st.heroStatus,
        legal: { status: st.legal.status, detail: st.legal.detail, context: st.legal.context }, discrepancies: st.discrepancies.slice(-20),
      },
      recommendation: this.rec,
      readiness: this.readiness(obs, st, decision),
      recorder: { enabled: this.settings.recordDiagnostics, recorded: this.recorder.recorded, dropped: this.recorder.dropped },
      participation: st.participation,
      timeline: h ? buildTimeline(h, st.meta) : [],
      hand: h ? {
        handId: h.handId, street: h.street, phase: h.phase, board: h.board.map(cardStr), pot: h.phase === 'complete' ? 0 : potTotal(h),
        heroSeat: st.heroSeat, heroCards: st.heroCards ? st.heroCards.map(cardStr) : null, heroPosition: heroSeatState?.pos?.label ?? null,
        effectiveStackBB: heroSeatState && !heroSeatState.folded && h.phase !== 'complete' ? effectiveStack(h, heroSeatState.seat) / h.bigBlind : null,
        bigBlind: h.bigBlind, smallBlind: h.smallBlind, heroStack: heroSeatState ? heroSeatState.stack : null, counts: st.heroSeat !== null ? tableCounts(h, st.heroSeat) : null,
        players: h.seats.map((s) => ({ seat: s.seat, name: s.name, playerId: s.playerId, position: s.pos?.label ?? null, stack: s.stack, streetCommit: s.streetCommit, folded: s.folded || !s.dealtIn, allIn: s.allIn, toAct: h.toAct === s.seat })),
      } : null,
      decision, lastExecution: this.lastExecution,
      deadlineMs: this.deadline !== null ? Math.max(0, this.deadline - this.deps.now()) : null,
      strategy: this.strategyView(),
      shadow: this.shadow && decision && this.shadow.key === this.rec.context?.key ? this.shadow : null,
      execution: executionStatus(this.settings, tableId),
      schedule: this.scheduleView(),
    };
  }

  private scheduleView(): ScheduleView {
    const now = this.deps.now(), sc = this.scheduler, p = sc.pending, plan = p ? sc.get(p.key) : undefined;
    return {
      policy: (({ mode, ...rest }) => ({ timingMode: mode, ...rest }))(this.policy()),
      pending: p && plan ? {
        key: p.key, label: p.label, decidedBy: p.decidedBy, fallback: p.fallback, state: p.state, targetDelayMs: plan.targetDelayMs, computeMs: p.computeMs,
        remainingMs: Math.max(0, plan.dueAt - now), deadlineInMs: plan.deadlineAt - now, deadlineSource: plan.deadlineSource, conflict: plan.conflict, capped: plan.capped,
      } : null,
      lastCancel: sc.lastCancel ? { label: sc.lastCancel.label, reason: sc.lastCancel.reason, agoMs: now - sc.lastCancel.at } : null,
      lastExecuted: sc.lastFired ? { label: sc.lastFired.label ?? '', reason: sc.lastFired.reason, delayMs: sc.lastFired.delayMs, computeMs: sc.lastFired.computeMs, waitedMs: sc.lastFired.waitedMs, conflict: sc.lastFired.conflict, agoMs: now - sc.lastFired.at } : null,
    };
  }
}
