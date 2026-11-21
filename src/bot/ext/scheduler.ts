// ============================================================
// Action scheduling for authorised autonomous play (0.9.1; two timing modes since 0.9.2).
//
// One plan per decision opportunity (hand, street, state version). Mode 'random': the delay is drawn ONCE, when
// Hero's turn is first confirmed, before any recommendation exists, so it cannot depend on the action. It is uniform
// between the configured minimum and maximum: a plain bounded range, not a model of human timing. Mode 'instant':
// the delay is 0, so the action is due as soon as the recommendation is ready (it still passes every check the
// controller and the executor make). Model computation runs inside the delay: the click is due at
//
//     start + delay, but never later than deadline − safety margin.
//
// The deadline is the clock the page shows when it shows one; otherwise the assumed clock from the start of the
// turn (never unlimited). When the time left before the margin is shorter than the minimum, the minimum is NOT
// met: the action is due at the latest safe moment and the conflict is reported. Repeated reads of the same
// opportunity reuse its plan (the delay is never redrawn and the start never moves); an observed clock only
// moves the deadline. Waiting can be cancelled at any moment, and the reason is kept for display.
//
// Pure apart from the injected clock and random source, so it is tested deterministically.
// ============================================================

export interface TimingPolicy {
  /** 'instant': no intentional waiting; 'random': uniform in [minDelayMs, maxDelayMs]. */
  mode: 'instant' | 'random';
  minDelayMs: number;
  maxDelayMs: number;
  /** Act no later than this long before the deadline. */
  deadlineMarginMs: number;
  /** Clock assumed from the start of the turn when the page shows none. */
  assumedClockMs: number;
}

export type DeadlineSource = 'observed' | 'assumed' | 'assumed, joined mid-turn';

export interface ActionPlan {
  key: string;
  /** When the opportunity was first confirmed on this page. */
  startedAt: number;
  /** The drawn delay (before any deadline cap). */
  targetDelayMs: number;
  deadlineAt: number;
  deadlineSource: DeadlineSource;
  /** deadline − margin. */
  latestSafeAt: number;
  /** When the action is due. */
  dueAt: number;
  /** The deadline leaves less than the minimum: the minimum is not met. */
  conflict: string | null;
  /** The drawn delay was shortened by the deadline (but the minimum is met). */
  capped: string | null;
  /** Created while Hero's turn was already running (page opened or reloaded mid-turn). */
  joinedMidTurn: boolean;
}

export interface PendingAction {
  key: string;
  label: string;
  decidedBy: string;
  fallback: string | null;
  /** Time the engine took, from the start of the opportunity to the recommendation. */
  computeMs: number;
  /** Intentional waiting planned after the recommendation was ready. */
  plannedWaitMs: number;
  state: 'waiting' | 'executing';
}

export interface ScheduleEvent { key: string; label: string | null; reason: string; at: number }

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The smallest delay the mode asks for: 0 when instant. */
export const minimumOf = (p: TimingPolicy): number => (p.mode === 'instant' ? 0 : p.minDelayMs);

/** The delay for one opportunity: 0 when instant; uniform in [min, max] when random (the minimum if max <= min). */
export function drawDelay(p: TimingPolicy, random: () => number): number {
  if (p.mode === 'instant') return 0;
  if (p.maxDelayMs <= p.minDelayMs) return p.minDelayMs;
  return p.minDelayMs + random() * (p.maxDelayMs - p.minDelayMs);
}

/** Where the action falls given the plan's start, drawn delay and deadline. */
export function place(plan: ActionPlan, p: TimingPolicy): ActionPlan {
  const latestSafeAt = plan.deadlineAt - p.deadlineMarginMs;
  const available = latestSafeAt - plan.startedAt;
  let dueAt = plan.startedAt + plan.targetDelayMs, conflict: string | null = null, capped: string | null = null;
  // Instant: due at once (in practice when the recommendation is ready); no minimum to meet, nothing to shorten.
  if (p.mode === 'instant') return Object.assign(plan, { latestSafeAt, dueAt: plan.startedAt, conflict, capped });
  if (p.mode === 'random' && available < p.minDelayMs) {
    conflict = `the ${plan.deadlineSource} deadline leaves ${s1(Math.max(0, available))} before the ${s1(p.deadlineMarginMs)} safety margin, less than the ${s1(p.minDelayMs)} minimum: acting at the latest safe moment instead`;
    dueAt = Math.max(plan.startedAt, latestSafeAt);
  } else if (dueAt > latestSafeAt) {
    capped = `drawn delay ${s1(plan.targetDelayMs)} shortened to ${s1(available)} by the ${plan.deadlineSource} deadline`;
    dueAt = latestSafeAt;
  }
  return Object.assign(plan, { latestSafeAt, dueAt, conflict, capped });
}

export class ActionScheduler {
  private readonly plans = new Map<string, ActionPlan>();
  private waiter: { key: string; wake: () => void } | null = null;
  pending: PendingAction | null = null;
  lastCancel: ScheduleEvent | null = null;
  lastFired: (ScheduleEvent & { delayMs: number; computeMs: number; waitedMs: number; conflict: string | null }) | null = null;

  constructor(private readonly now: () => number, private readonly random: () => number) {}

  /**
   * The plan for a confirmed opportunity: created (and its delay drawn) on first sight, reused afterwards. Only an
   * observed clock changes an existing plan, and only its deadline.
   */
  plan(key: string, startedAt: number, deadline: { at: number | null; observed: boolean }, p: TimingPolicy, joinedMidTurn: boolean): ActionPlan {
    let plan = this.plans.get(key);
    if (!plan) {
      const observed = deadline.observed && deadline.at !== null;
      let target = drawDelay(p, this.random);
      // Opened (or reloaded) during Hero's turn with no clock shown: when the turn began is unknown, so the
      // assumed clock may already be partly used. Wait only the minimum.
      if (joinedMidTurn && !observed) target = minimumOf(p);
      plan = {
        key, startedAt, targetDelayMs: target, joinedMidTurn,
        deadlineAt: observed ? deadline.at! : startedAt + p.assumedClockMs,
        deadlineSource: observed ? 'observed' : joinedMidTurn ? 'assumed, joined mid-turn' : 'assumed',
        latestSafeAt: 0, dueAt: 0, conflict: null, capped: null,
      };
      this.plans.set(key, plan);
      if (this.plans.size > 50) this.plans.delete(this.plans.keys().next().value as string);
    } else if (deadline.observed && deadline.at !== null) {
      plan.deadlineAt = deadline.at;
      plan.deadlineSource = 'observed';
    }
    return place(plan, p);
  }

  get(key: string): ActionPlan | undefined { return this.plans.get(key); }

  /**
   * The timing settings changed (for example Random -> Instant while an action is pending): every known plan keeps
   * its start and deadline, its delay is drawn again under the new policy, and it is placed again. The caller cancels
   * the pending action first and decides the opportunity again, so the new plan governs the next click.
   */
  replan(p: TimingPolicy): void {
    for (const plan of this.plans.values()) {
      plan.targetDelayMs = plan.joinedMidTurn && plan.deadlineSource !== 'observed' ? minimumOf(p) : drawDelay(p, this.random);
      place(plan, p);
    }
  }

  /** A recommendation is ready and will be executed when due. Replaces nothing: one pending action at a time. */
  arm(a: Omit<PendingAction, 'state' | 'plannedWaitMs'>): PendingAction | null {
    const plan = this.plans.get(a.key);
    if (!plan) return null;
    this.pending = { ...a, plannedWaitMs: Math.max(0, plan.dueAt - this.now()), state: 'waiting' };
    return this.pending;
  }

  /**
   * Wait until the action is due. Returns false as soon as it is cancelled (cancel() wakes the wait at once; the
   * predicate is also checked between steps). Steps are short so a deadline that moves is followed.
   */
  async waitUntilDue(key: string, sleep: (ms: number) => Promise<void>, isCancelled: () => boolean): Promise<boolean> {
    for (;;) {
      const plan = this.plans.get(key);
      if (!plan || isCancelled() || this.pending?.key !== key) return false;
      const left = plan.dueAt - this.now();
      if (left <= 0) return true;
      await new Promise<void>((resolve) => {
        this.waiter = { key, wake: resolve };
        void sleep(Math.min(left, 250)).then(() => resolve());
      });
      this.waiter = null;
    }
  }

  /** The pending action is being executed now (no cancellation can recall a click already sent). */
  firing(key: string): void { if (this.pending?.key === key) { this.pending.state = 'executing'; this.firingAt = this.now(); } }
  private firingAt: number | null = null;

  fired(key: string, label: string, reason: string): void {
    const plan = this.plans.get(key);
    const p = this.pending?.key === key ? this.pending : null;
    const at = this.now();
    // Timing is measured to the moment the action was sent, not to the end of the table's confirmation.
    const sentAt = this.firingAt ?? at;
    this.firingAt = null;
    this.lastFired = {
      key, label, reason, at, delayMs: plan ? sentAt - plan.startedAt : 0, computeMs: p?.computeMs ?? 0,
      waitedMs: p && plan ? Math.max(0, sentAt - plan.startedAt - p.computeMs) : 0, conflict: plan?.conflict ?? null,
    };
    if (p) this.pending = null;
  }

  /** Drop the pending action, if any, and say why. Wakes a wait immediately. */
  cancel(reason: string): void {
    const p = this.pending;
    if (p && p.state === 'waiting') {
      this.lastCancel = { key: p.key, label: p.label, reason, at: this.now() };
      this.pending = null;
    }
    const w = this.waiter;
    this.waiter = null;
    w?.wake();
  }
}
