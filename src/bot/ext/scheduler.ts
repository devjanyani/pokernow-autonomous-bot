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
// Background tabs (3.1b). Browsers delay page timers in hidden tabs (Chrome: at most one wake-up per second, and
// for chained timers sometimes much longer; the 2026-11-21 recording shows a 250 ms wait released 24.6 s late, the
// moment the tab became visible again). No page timer can guarantee a deadline, so the scheduler does not try to:
// every wake-up is measured against the monotonic page clock, and an action whose latest safe moment has passed,
// whose start is not known closely enough, or whose wait spanned a pause in which the wall clock and the page clock
// diverged, is EXPIRED: it is cancelled with the reason, never sent late.
//
// Every armed action is one attempt with its own identity (`id`); firing and timing are recorded on that object, so
// a second attempt can never overwrite the timing of the first (the 2026-11-21 hand 17 record).
//
// Pure apart from the injected clocks and random source, so it is tested deterministically.
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
  /**
   * How long before `startedAt` the turn may already have begun: the time since the previous read of the table
   * (about 250 ms normally; much longer when the browser held the page's timers). The assumed deadline counts from
   * the earliest possible start.
   */
  startUncertaintyMs: number;
  /** Why the deadline cannot be established (no clock shown and the start is too uncertain), or null. */
  unreliable: string | null;
}

/** A wake-up this much later than requested is reported as delayed page timers. */
export const TIMER_LATE_MS = 1000;
/** Past the latest safe moment by more than this: the action has expired and is not sent. */
export const LATE_TOLERANCE_MS = 500;
/** With no clock shown, a turn start known only to within this cannot anchor the assumed deadline. */
export const UNRELIABLE_START_MS = 2000;
/** The wall clock and the monotonic page clock moved apart by more than this during one wait: a suspension. */
export const CLOCK_JUMP_MS = 1000;

export type WaitResult = 'due' | 'cancelled' | 'expired';

export interface PendingAction {
  /** Identity of this attempt (unique on the page). One opportunity normally has one attempt. */
  id: number;
  key: string;
  label: string;
  decidedBy: string;
  fallback: string | null;
  /** Time the engine took, from the start of the opportunity to the recommendation. */
  computeMs: number;
  /** Intentional waiting planned after the recommendation was ready. */
  plannedWaitMs: number;
  state: 'waiting' | 'executing';
  armedAt: number;
  /** When this attempt was handed to the executor (the click is sent right after the executor's checks). */
  firingAt: number | null;
  /** Largest delay of one of this attempt's wake-ups beyond the time asked for. */
  maxLateMs: number;
  lateWakeups: number;
  /** Largest divergence of wall clock and page clock over one wait step (a suspension of the page or computer). */
  clockJumpMs: number;
  /** Why the attempt expired, when it did. */
  expiry: string | null;
}

export interface ScheduleEvent { key: string; label: string | null; reason: string; at: number; attempt?: number; kind?: 'cancelled' | 'expired' }
export interface FiredEvent extends ScheduleEvent { delayMs: number; computeMs: number; waitedMs: number; conflict: string | null; attempt: number; maxLateMs: number }

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
  lastFired: FiredEvent | null = null;
  private attempts = 0;
  /** Told about every attempt that ends without being executed (cancelled or expired), once. */
  onSettle: ((p: PendingAction, kind: 'cancelled' | 'expired', reason: string) => void) | null = null;
  /** Told about every wake-up that came at least TIMER_LATE_MS late. */
  onLate: ((p: PendingAction, lateMs: number) => void) | null = null;

  /** `wall` is the wall clock (Date.now); it is only compared with `now` to detect a suspension. */
  constructor(private readonly now: () => number, private readonly random: () => number, private readonly wall: (() => number) | null = null) {}

  /**
   * The plan for a confirmed opportunity: created (and its delay drawn) on first sight, reused afterwards. Only an
   * observed clock changes an existing plan, and only its deadline.
   */
  plan(key: string, startedAt: number, deadline: { at: number | null; observed: boolean }, p: TimingPolicy, joinedMidTurn: boolean, startUncertaintyMs = 0): ActionPlan {
    let plan = this.plans.get(key);
    if (!plan) {
      const observed = deadline.observed && deadline.at !== null;
      let target = drawDelay(p, this.random);
      // Opened (or reloaded) during Hero's turn with no clock shown: when the turn began is unknown, so the
      // assumed clock may already be partly used. Wait only the minimum.
      if (joinedMidTurn && !observed) target = minimumOf(p);
      const u = Math.max(0, startUncertaintyMs);
      plan = {
        key, startedAt, targetDelayMs: target, joinedMidTurn, startUncertaintyMs: u,
        // No clock shown: counted from the EARLIEST moment the turn can have begun.
        deadlineAt: observed ? deadline.at! : startedAt - u + p.assumedClockMs,
        deadlineSource: observed ? 'observed' : joinedMidTurn ? 'assumed, joined mid-turn' : 'assumed',
        latestSafeAt: 0, dueAt: 0, conflict: null, capped: null,
        unreliable: !observed && u > UNRELIABLE_START_MS
          ? `Hero's turn was first read ${s1(u)} after the previous read of the table (the browser delayed the page's timers), and no clock is shown: when the turn began, and so its deadline, is not known`
          : null,
      };
      this.plans.set(key, plan);
      if (this.plans.size > 50) this.plans.delete(this.plans.keys().next().value as string);
    } else if (deadline.observed && deadline.at !== null) {
      plan.deadlineAt = deadline.at;
      plan.deadlineSource = 'observed';
      plan.unreliable = null;
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

  /** A recommendation is ready and will be executed when due. One pending action at a time; none while one is executing. */
  arm(a: Pick<PendingAction, 'key' | 'label' | 'decidedBy' | 'fallback' | 'computeMs'>): PendingAction | null {
    const plan = this.plans.get(a.key);
    if (!plan) return null;
    // An attempt whose click is in flight is never replaced: a second attempt cannot take over its identity or timing.
    if (this.pending && this.pending.state === 'executing') return null;
    const now = this.now();
    this.pending = {
      ...a, id: ++this.attempts, plannedWaitMs: Math.max(0, plan.dueAt - now), state: 'waiting', armedAt: now,
      firingAt: null, maxLateMs: 0, lateWakeups: 0, clockJumpMs: 0, expiry: null,
    };
    return this.pending;
  }

  /**
   * Whether this attempt may still be executed now, judged on the monotonic page clock: null when it may, otherwise
   * why not. Checked after every wake-up and once more immediately before the click.
   */
  verdict(p: PendingAction, now = this.now()): string | null {
    const plan = this.plans.get(p.key);
    if (!plan) return 'the timing plan of this decision point is gone';
    if (plan.unreliable) return plan.unreliable;
    if (p.clockJumpMs > CLOCK_JUMP_MS) return `the wall clock and the page clock moved apart by ${s1(p.clockJumpMs)} while waiting (the page or the computer was suspended): the time left on Hero's turn is not known`;
    const over = now - plan.latestSafeAt;
    if (over > LATE_TOLERANCE_MS) {
      return `${s1(over)} past the latest safe moment (${s1(plan.latestSafeAt - plan.startedAt)} into the turn, ${plan.deadlineSource} deadline)${p.maxLateMs >= TIMER_LATE_MS ? `; the browser delayed the page's timers by up to ${s1(p.maxLateMs)}` : ''}: an expired decision is never executed`;
    }
    return null;
  }

  /**
   * Wait until the attempt is due. 'cancelled' as soon as it is cancelled (cancel() wakes the wait at once; the
   * predicate is also checked between steps), 'expired' when a wake-up finds it can no longer be executed (the
   * attempt is then settled as expired, with the reason). Steps are short so a deadline that moves is followed.
   */
  async waitFor(p: PendingAction, sleep: (ms: number) => Promise<void>, isCancelled: () => boolean): Promise<WaitResult> {
    for (;;) {
      const plan = this.plans.get(p.key);
      if (!plan || isCancelled() || this.pending !== p) return 'cancelled';
      const v = this.verdict(p);
      if (v) { this.expire(p, v); return 'expired'; }
      const left = plan.dueAt - this.now();
      if (left <= 0) return 'due';
      const step = Math.min(left, 250);
      const m0 = this.now(), w0 = this.wall ? this.wall() : null;
      let woken = false;
      await new Promise<void>((resolve) => {
        this.waiter = { key: p.key, wake: () => { woken = true; resolve(); } };
        void sleep(step).then(() => resolve());
      });
      this.waiter = null;
      const m1 = this.now();
      if (w0 !== null && this.wall) {
        const jump = Math.abs((this.wall() - w0) - (m1 - m0));
        if (jump > p.clockJumpMs) p.clockJumpMs = jump;
      }
      if (woken) continue;
      const late = m1 - (m0 + step);
      if (late > p.maxLateMs) p.maxLateMs = late;
      if (late >= TIMER_LATE_MS) { p.lateWakeups++; this.onLate?.(p, late); }
    }
  }

  /** Compatibility wrapper (0.9.1 callers): true when the pending attempt for this key is due. */
  async waitUntilDue(key: string, sleep: (ms: number) => Promise<void>, isCancelled: () => boolean): Promise<boolean> {
    const p = this.pending;
    if (!p || p.key !== key) return false;
    return (await this.waitFor(p, sleep, isCancelled)) === 'due';
  }

  /** This attempt is being executed now (no cancellation can recall a click already sent). */
  firing(p: PendingAction): void {
    if (this.pending !== p) return;
    p.state = 'executing';
    p.firingAt = this.now();
  }

  /** The attempt's outcome is known. Timing is taken from THIS attempt only, up to the moment it was sent. */
  fired(p: PendingAction, label: string, reason: string): FiredEvent {
    const plan = this.plans.get(p.key);
    const at = this.now();
    const sentAt = p.firingAt ?? at;
    this.lastFired = {
      key: p.key, label, reason, at, attempt: p.id, maxLateMs: p.maxLateMs,
      delayMs: plan ? sentAt - plan.startedAt : 0, computeMs: p.computeMs,
      waitedMs: plan ? Math.max(0, sentAt - plan.startedAt - p.computeMs) : 0, conflict: plan?.conflict ?? null,
    };
    if (this.pending === p) this.pending = null;
    return this.lastFired;
  }

  private settle(p: PendingAction, kind: 'cancelled' | 'expired', reason: string): void {
    this.lastCancel = { key: p.key, label: p.label, reason, at: this.now(), attempt: p.id, kind };
    if (this.pending === p) this.pending = null;
    this.onSettle?.(p, kind, reason);
  }

  private expire(p: PendingAction, reason: string): void {
    if (p.state !== 'waiting') return;
    p.expiry = reason;
    this.settle(p, 'expired', reason);
  }

  /** The attempt was not executed after all (permission withdrawn or the clock ran out just before the click). */
  abandon(p: PendingAction, kind: 'cancelled' | 'expired', reason: string): void {
    if (this.pending !== p) return;
    if (kind === 'expired') p.expiry = reason;
    p.state = 'waiting';
    this.settle(p, kind, reason);
  }

  /** Drop the pending action, if any, and say why. Wakes a wait immediately. */
  cancel(reason: string): void {
    const p = this.pending;
    if (p && p.state === 'waiting') this.settle(p, 'cancelled', reason);
    const w = this.waiter;
    this.waiter = null;
    w?.wake();
  }
}
