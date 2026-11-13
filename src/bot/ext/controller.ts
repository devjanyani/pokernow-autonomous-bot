// ============================================================
// Live controller: observe -> reconstruct -> decide -> (optionally) act.
//
// Runs in the content script, but has no direct DOM or chrome.* dependency:
// everything external comes in through ControllerDeps, so the whole loop is
// exercised in tests with a simulated table.
//
// Separation of duties:
//   observer (deps.observe)        reads the page
//   HandTracker                    validated game state
//   BotAgent                       strategy only, never touches the page
//   GuardedExecutor + deps.driver  the only path to a click
// ============================================================

import { cardStr } from '../cards';
import { BotAgent, DecisionCancelled } from '../agent';
import { GuardedExecutor, TableDriver } from '../adapter/executor';
import { TableObs } from '../adapter/observation';
import { CompletedHand, HandTracker } from '../adapter/tracker';
import { PlayerProfile, sanitizeProfile } from '../opponents/profile';
import { Decision } from '../strategy/types';
import { cloneHand, effectiveStack, legalActions, potTotal, tableCounts } from '../table/engine';
import { SAFETY_MARGIN_MS } from '../time/budget';
import { BotMessage, DecisionRecord, LiveState, mayAct, Settings, toHandRecord } from './records';

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

export class LiveController {
  readonly tracker = new HandTracker();
  agent: BotAgent;
  readonly executor: GuardedExecutor;
  private settings: Settings;
  private lastObs: TableObs | null = null;
  private decision: Decision | null = null;
  private decisionKey: string | null = null;
  private deciding = false;
  private turnKey: string | null = null;
  private turnStart = 0;
  private deadline: number | null = null;
  private status = 'starting';
  private lastExecution: LiveState['lastExecution'] = null;
  private readonly requested = new Set<string>();
  private readonly fallbackDone = new Set<string>();
  private lastPublish = 0;
  private pendingCompleted: CompletedHand[] = [];

  constructor(private readonly deps: ControllerDeps, settings: Settings, seed = 1) {
    this.settings = settings;
    this.agent = new BotAgent({ exploitWeight: settings.exploitWeight, seed, now: deps.now });
    this.executor = new GuardedExecutor(deps.driver, () => this.read(), { minConfidence: settings.minConfidence, sleep: deps.sleep, now: deps.now });
  }

  updateSettings(s: Settings): void {
    const exploitChanged = s.exploitWeight !== this.settings.exploitWeight;
    this.settings = s;
    if (exploitChanged) {
      const old = this.agent.profiles;
      this.agent = new BotAgent({ exploitWeight: s.exploitWeight, now: this.deps.now });
      for (const [k, v] of old) this.agent.profiles.set(k, v);
    }
    if (s.estop || s.mode !== 'autonomous') this.executor.stop();
    // Any settings change invalidates the decision in flight: the next tick decides again under the
    // new mode (for example recommend -> autonomous while it is Hero's turn). The executor's own
    // used-decision-point record still prevents a second click for a point already acted on.
    this.decisionKey = null;
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
    this.deps.send({ type: 'bot/diag', record: { ts: this.deps.now(), level, source: 'controller', message, data } });
  }

  private handleCompleted(tableId: string): void {
    for (const c of this.pendingCompleted.splice(0)) {
      let profiles: PlayerProfile[] = [];
      if (c.valid) {
        const ids = this.agent.observeHand(c.hand, c.reveals, Date.now());
        profiles = ids.map((id) => this.agent.profiles.get(id)!).filter((p) => !p.playerId.startsWith('ambiguous:'));
      } else this.diag('warn', `hand ${c.hand.handId} not used for profiles (${c.observedToEnd ? 'reconstruction invalid' : 'ending not observed'})`);
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
    const h = state.hand;
    const heroTurn = !!h && state.heroSeat !== null && h.toAct === state.heroSeat && obs.heroToAct;
    const now = this.deps.now();

    if (!heroTurn) {
      // Not our decision (any more): drop any computation in flight.
      this.decisionKey = null; this.turnKey = null; this.deadline = null;
      if (!obs.heroToAct) this.decision = h && h.phase !== 'complete' ? this.decision : null;
      this.status = state.unsupported ? 'unsupported game: observing only' : !h ? (state.waitingReason ?? 'waiting') : !state.valid ? 'state invalid: waiting for the next hand' : 'watching';
      // The table says it is our turn but the state cannot be trusted.
      if (obs.heroToAct && (!h || !state.valid || state.heroSeat === null || h.toAct !== state.heroSeat)) this.untrustedTurn(obs, now);
      this.publish();
      return;
    }

    const key = `${h!.handId}|${h!.street}|${state.eventCount}`;
    if (this.turnKey !== key) {
      this.turnKey = key; this.turnStart = now; this.decision = null;
      this.deadline = now + (obs.timeRemainingMs ?? this.settings.assumedClockMs);
    } else if (obs.timeRemainingMs !== null) this.deadline = now + obs.timeRemainingMs;

    if (this.settings.mode === 'manual') { this.status = 'manual mode: observing only'; this.publish(); return; }
    if (state.confidence < this.settings.minConfidence || !state.heroCards) {
      this.status = `paused: state confidence ${state.confidence.toFixed(2)} (${state.issues[state.issues.length - 1] ?? 'hero cards unreadable'})`;
      this.untrustedTurn(obs, now);
      this.publish();
      return;
    }
    if (this.decisionKey !== key && !this.deciding) void this.decide(key);
    this.publish();
  }

  /** Hero must act but the state is not trusted: optionally check/fold when the clock is nearly out. */
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

  private async decide(key: string): Promise<void> {
    const state = this.tracker.state;
    const h = cloneHand(state.hand!);
    const heroSeat = state.heroSeat!, heroCards = state.heroCards!;
    const obs = this.lastObs!;
    this.decisionKey = key;
    this.deciding = true;
    this.status = 'thinking';
    const cancelled = () => this.decisionKey !== key;
    let d: Decision;
    try {
      // Time available to the engine: the clock minus the think-time floor we may still add.
      const remaining = (this.deadline ?? this.deps.now() + this.settings.assumedClockMs) - this.deps.now();
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
    const record: DecisionRecord = {
      handId: h.handId, tableId: obs.tableId, ts: Date.now(), eventCount: h.events.length, heroCards: heroCards.map(cardStr), board: h.board.map(cardStr),
      pot: potTotal(h), decision: d, execution: null,
    };
    if (!mayAct(this.settings, obs.tableId)) {
      this.status = `recommendation: ${d.label}`;
      this.deps.send({ type: 'bot/decision', record });
      this.publish(true);
      return;
    }
    // Bounded timing variation, never past the deadline.
    const elapsed = this.deps.now() - this.turnStart;
    const target = this.settings.minThinkMs + this.deps.random() * (this.settings.maxThinkMs - this.settings.minThinkMs);
    const room = (this.deadline ?? Infinity) - this.deps.now() - SAFETY_MARGIN_MS;
    const wait = Math.max(0, Math.min(target - elapsed, room));
    if (wait > 0) { this.status = `acting in ${(wait / 1000).toFixed(1)}s: ${d.label}`; this.publish(true); await this.deps.sleep(wait); }
    if (cancelled()) return;
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
    this.lastExecution = { status: out.status, reason: out.reason, ms: out.ms, action: d.label };
    record.execution = { status: out.status, reason: out.reason, ms: out.ms };
    this.status = `${out.status}: ${d.label} (${out.reason})`;
    if (out.status !== 'accepted') this.diag(out.status === 'rejected' ? 'info' : 'warn', `execution ${out.status}: ${out.reason}`, req);
    this.deps.send({ type: 'bot/decision', record });
    this.publish(true);
  }

  private publish(force = false): void {
    const now = this.deps.now();
    if (!force && now - this.lastPublish < 250) return;
    this.lastPublish = now;
    const live = this.snapshot();
    this.deps.render(live);
    this.deps.send({ type: 'bot/live', live });
  }

  snapshot(): LiveState {
    const obs = this.lastObs;
    const st = this.tracker.state;
    const h = st.hand;
    const tableId = obs?.tableId ?? 'unknown';
    const heroSeatState = h && st.heroSeat !== null ? h.seats.find((s) => s.seat === st.heroSeat) : undefined;
    return {
      ts: Date.now(), tableId, mode: this.settings.mode, acting: mayAct(this.settings, tableId), estop: this.settings.estop, status: this.status,
      observation: { health: this.deps.health(), problems: obs?.problems ?? [], heroToAct: obs?.heroToAct ?? false, timeRemainingMs: obs?.timeRemainingMs ?? null },
      tracker: { valid: st.valid, confidence: st.confidence, unsupported: st.unsupported, issues: st.issues, waitingReason: st.waitingReason, handsSeen: st.handsSeen },
      hand: h ? {
        handId: h.handId, street: h.street, phase: h.phase, board: h.board.map(cardStr), pot: h.phase === 'complete' ? 0 : potTotal(h),
        heroSeat: st.heroSeat, heroCards: st.heroCards ? st.heroCards.map(cardStr) : null, heroPosition: heroSeatState?.pos?.label ?? null,
        effectiveStackBB: heroSeatState && !heroSeatState.folded && h.phase !== 'complete' ? effectiveStack(h, heroSeatState.seat) / h.bigBlind : null,
        bigBlind: h.bigBlind, counts: st.heroSeat !== null ? tableCounts(h, st.heroSeat) : null,
        players: h.seats.map((s) => ({ seat: s.seat, name: s.name, playerId: s.playerId, position: s.pos?.label ?? null, stack: s.stack, streetCommit: s.streetCommit, folded: s.folded || !s.dealtIn, allIn: s.allIn, toAct: h.toAct === s.seat })),
      } : null,
      decision: this.decision, lastExecution: this.lastExecution,
      deadlineMs: this.deadline !== null ? Math.max(0, this.deadline - this.deps.now()) : null,
    };
  }
}
