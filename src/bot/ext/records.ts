// ============================================================
// Plain-JSON records exchanged between the content script, the background
// service worker and the dashboard, plus settings. Everything here is
// structured-clone safe (no Maps, no class instances).
// ============================================================

import { cardStr } from '../cards';
import type { CompletedHand, ResultCheck } from '../adapter/tracker';
import type { Decision } from '../strategy/types';
import type { PlayerProfile } from '../opponents/profile';
import type { DebugFrame } from '../diag/recorder';
import type { TimelineEntry } from '../diag/timeline';
import type { SeatParticipation } from '../adapter/tracker';

export type Mode = 'manual' | 'recommend' | 'autonomous';

export interface Settings {
  version: 1;
  /** manual: observe and profile only. recommend: also show decisions. autonomous: also act (needs authorization). */
  mode: Mode;
  /** Emergency stop: when true nothing is ever clicked, whatever the mode. */
  estop: boolean;
  /** The user confirmed that automated play is authorised for the listed tables (a bot-vs-bot competition). */
  authorizationConfirmed: boolean;
  authorizedTables: string[];
  /** 0..1 weight of opponent-specific adjustments. */
  exploitWeight: number;
  /**
   * Action scheduling on authorised tables (scheduler.ts), two mutually exclusive modes (0.9.2):
   *   'random'  one delay per decision opportunity, drawn when Hero's turn is confirmed, uniform in
   *             [minDelayMs, maxDelayMs], the same for every action type, computation included (the default);
   *   'instant' no intentional waiting: the action is executed as soon as the recommendation is ready and has passed
   *             the same permission, reconciliation and legality checks.
   * Both: never past the deadline minus deadlineMarginMs. Replaces 0.9.1's `randomDelay` (migrated on read).
   */
  timingMode: TimingMode;
  minDelayMs: number;
  maxDelayMs: number;
  deadlineMarginMs: number;
  /** Action clock assumed when the page does not show one (ms). */
  assumedClockMs: number;
  /** Minimum state confidence required to act. */
  minConfidence: number;
  showPanel: boolean;
  /** When the clock is nearly out and no decision could be made safely: 'check-fold' or 'nothing'. */
  timeoutAction: 'check-fold' | 'nothing';
  /** Optional CSS selector overrides for the PokerNow adapter (key -> selector). */
  selectorOverrides: Record<string, string>;
  /** Keep a bounded local recording of observations and reconstruction for the debug bundle. */
  recordDiagnostics: boolean;
  /**
   * Strategy experiment: which engine produces recommendations. 'v2' (0.6.0, the default), 'v1' (0.5.1), or 'v3'
   * (experimental, 0.9.0): version 3 is RECOMMENDATION-ONLY, mayAct() is false whenever it is selected.
   * None is shown to be better against real opponents; see docs/bot/STRATEGY_V2_DIAGNOSIS.md and
   * reports/PHASE_2_5_STRATEGY_BENCHMARK.md. Only an explicit choice selects version 3: a stored value that is not
   * one of the three names reads as the default.
   */
  strategyEngine: StrategyEngine;
  /**
   * Diagnostic only, off by default: while version 2 is selected, also compute what version 3 would recommend after
   * version 2's recommendation is complete, and show both on the dashboard. Never executed.
   */
  shadowV3: boolean;
  /**
   * Experimental, off by default: let version 3 act on tables that are authorised for autonomous play. Separate from
   * choosing version 3 (choosing it never authorises clicking) and from the table authorisation (both are needed).
   * Cleared whenever the authorisation confirmation is withdrawn.
   */
  v3ExecutionOptIn: boolean;
}
export type StrategyEngine = 'v1' | 'v2' | 'v3';
export type TimingMode = 'instant' | 'random';

export const DEFAULT_SETTINGS: Settings = {
  version: 1, mode: 'recommend', estop: false, authorizationConfirmed: false, authorizedTables: [],
  exploitWeight: 1, timingMode: 'random', minDelayMs: 4000, maxDelayMs: 20000, deadlineMarginMs: 3000, assumedClockMs: 20000, minConfidence: 0.7,
  showPanel: true, timeoutAction: 'check-fold', selectorOverrides: {}, recordDiagnostics: true, strategyEngine: 'v2', shadowV3: false, v3ExecutionOptIn: false,
};

const clamp = (x: unknown, lo: number, hi: number, def: number): number => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

/**
 * Timing mode with the 0.9.1 migration. A stored `timingMode` wins. Otherwise (settings written by 0.9.1, which had
 * a `randomDelay` switch): randomDelay off with a 0 s minimum was "no waiting" and becomes 'instant' (the stored
 * maximum is kept, the minimum returns to the default for a later switch to Random); randomDelay off with a positive
 * minimum was a fixed delay and stays one ('random' with maximum = minimum); anything else is 'random' with the stored
 * bounds. Nothing the user chose is lost.
 */
function timingFields(r: Record<string, unknown>, minDelayMs: number, maxDelayMs: number): Pick<Settings, 'timingMode' | 'minDelayMs' | 'maxDelayMs'> {
  if (r.timingMode === 'instant' || r.timingMode === 'random') return { timingMode: r.timingMode, minDelayMs, maxDelayMs };
  if (r.randomDelay === false) {
    if (minDelayMs === 0) { const min = DEFAULT_SETTINGS.minDelayMs; return { timingMode: 'instant', minDelayMs: min, maxDelayMs: Math.max(min, maxDelayMs) }; }
    return { timingMode: 'random', minDelayMs, maxDelayMs: minDelayMs };
  }
  return { timingMode: 'random', minDelayMs, maxDelayMs };
}

/** Validate anything read from storage or received in a message. Unknown fields are dropped. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const mode: Mode = r.mode === 'manual' || r.mode === 'recommend' || r.mode === 'autonomous' ? r.mode : d.mode;
  const minDelayMs = clamp(r.minDelayMs, 0, 60000, d.minDelayMs);
  const authorizationConfirmed = r.authorizationConfirmed === true;
  const overrides: Record<string, string> = {};
  if (r.selectorOverrides && typeof r.selectorOverrides === 'object') {
    for (const [k, v] of Object.entries(r.selectorOverrides as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0 && v.length < 300 && /^[\w-]+$/.test(k)) overrides[k] = v;
    }
  }
  return {
    version: 1, mode, estop: r.estop === true, authorizationConfirmed,
    authorizedTables: Array.isArray(r.authorizedTables) ? r.authorizedTables.filter((t): t is string => typeof t === 'string' && /^[\w-]{1,80}$/.test(t)).slice(0, 50) : [],
    exploitWeight: clamp(r.exploitWeight, 0, 1, d.exploitWeight),
    ...timingFields(r, minDelayMs, Math.max(minDelayMs, clamp(r.maxDelayMs, 0, 120000, d.maxDelayMs))),
    deadlineMarginMs: clamp(r.deadlineMarginMs, 500, 10000, d.deadlineMarginMs),
    assumedClockMs: clamp(r.assumedClockMs, 3000, 120000, d.assumedClockMs),
    minConfidence: clamp(r.minConfidence, 0.4, 1, d.minConfidence),
    showPanel: r.showPanel !== false, timeoutAction: r.timeoutAction === 'nothing' ? 'nothing' : 'check-fold', selectorOverrides: overrides,
    recordDiagnostics: r.recordDiagnostics !== false,
    strategyEngine: r.strategyEngine === 'v1' || r.strategyEngine === 'v3' ? r.strategyEngine : 'v2',
    shadowV3: r.shadowV3 === true,
    v3ExecutionOptIn: r.v3ExecutionOptIn === true && authorizationConfirmed,
  };
}

/**
 * Change settings by reading the stored value first, so that a page holding an older copy (popup, dashboard,
 * table tab) can never write back something another page removed, such as a revoked table authorisation.
 */
export async function patchSettings(area: { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> }, change: Partial<Settings> | ((cur: Settings) => Partial<Settings>)): Promise<Settings> {
  const cur = sanitizeSettings((await area.get('settings')).settings);
  const next = sanitizeSettings({ ...cur, ...(typeof change === 'function' ? change(cur) : change) });
  await area.set({ settings: next });
  return next;
}

/**
 * True only when clicking is permitted for this table right now: autonomous mode, no emergency stop, the
 * organiser-authorisation confirmation, this table authorised, and, while the experimental version 3 engine is
 * selected, the separate version 3 execution opt-in. This is the single gate every click path goes through (the
 * executor's arming, the scheduled action just before it is executed, and the timeout fallback).
 */
export function mayAct(s: Settings, tableId: string): boolean {
  return executionStatus(s, tableId).enabled;
}

/** Whether execution is enabled on this table and, when it is not, the first reason. */
export function executionStatus(s: Settings, tableId: string): { enabled: boolean; reason: string } {
  if (s.estop) return { enabled: false, reason: 'emergency stop is on' };
  if (s.mode !== 'autonomous') return { enabled: false, reason: `mode is ${s.mode === 'recommend' ? 'recommend' : 'manual'}` };
  if (!s.authorizationConfirmed) return { enabled: false, reason: 'the organiser-authorisation confirmation is not given' };
  if (!s.authorizedTables.includes(tableId)) return { enabled: false, reason: 'this table is not authorised' };
  if (s.strategyEngine === 'v3' && !s.v3ExecutionOptIn) return { enabled: false, reason: 'version 3 is recommendation-only unless its experimental execution permission is switched on' };
  return { enabled: true, reason: s.strategyEngine === 'v3' ? 'authorised table, version 3 execution permission on (experimental)' : 'authorised table' };
}

/** The strategy shown on the dashboard and the panel, whatever the current spot. */
export interface StrategyView {
  selected: StrategyEngine;
  experimental: boolean;
  /** True when nothing can be clicked because of the strategy choice (version 3 without its execution opt-in). */
  recommendOnly: boolean;
  /** Version 3 is selected and its experimental execution permission is on. */
  v3Execution: boolean;
  shadowV3: boolean;
  /** Version 3: load status and provenance of the fitted tables packaged with the extension. */
  artifacts: { name: string; state: string; reason: string | null; source: string | null; fittedOn: string | null; cells: number }[];
}

/** Shadow comparison (diagnostic only): version 2's recommendation next to version 3's for the same decision point. */
export interface ShadowComparison {
  key: string;
  v2: { label: string; action: string; to: number | null; ev: number | null };
  v3: { label: string; action: string; to: number | null; ev: number | null; used: string; fallback: string | null; computeMs: number } | null;
  /** Why there is no version 3 result yet or at all (computing, cancelled, error). */
  note: string | null;
  sameAction: boolean | null;
  /** Both bet or both raise, to different amounts. */
  sizeDiffers: boolean | null;
}

export interface HandRecord {
  handId: string;
  tableId: string;
  ts: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  board: string[];
  seats: { seat: number; name: string; playerId: string; position: string | null; startStack: number; endStack: number; folded: boolean; dealtIn: boolean; shown: string[] | null }[];
  events: { seq: number; seat: number; street: string; kind: string; amount: number; to: number; allIn: boolean; potBefore: number; source?: string; inferred?: boolean; uncertain?: boolean }[];
  heroSeat: number | null;
  heroCards: string[] | null;
  heroNet: number | null;
  wentToShowdown: boolean;
  valid: boolean;
  observedToEnd: boolean;
  /**
   * The settled stacks compared with the stacks at the start of the next hand (0.7.0 on; absent on older records and
   * when no next hand was seen). `heroNet` is always the result settled from the cards shown; when the status is
   * 'awarded-differently' the table's result is heroNet + heroDiff.
   */
  stackCheck?: StackCheck;
}
export type StackCheck = Pick<ResultCheck, 'status' | 'heroDiff' | 'note'>;
export const toStackCheck = (c: ResultCheck): StackCheck => ({ status: c.status, heroDiff: c.heroDiff, note: c.note });

export function toHandRecord(c: CompletedHand, tableId: string, ts: number): HandRecord {
  const h = c.hand;
  const hero = c.heroSeat !== null ? h.seats.find((s) => s.seat === c.heroSeat) : undefined;
  return {
    handId: h.handId, tableId, ts, smallBlind: h.smallBlind, bigBlind: h.bigBlind, ante: h.ante, board: h.board.map(cardStr),
    seats: h.seats.map((s) => ({
      seat: s.seat, name: s.name, playerId: s.playerId, position: s.pos?.label ?? null, startStack: s.startStack, endStack: s.stack,
      folded: s.folded, dealtIn: s.dealtIn, shown: c.reveals.has(s.seat) ? c.reveals.get(s.seat)!.map(cardStr) : null,
    })),
    events: h.events.map((e) => ({ seq: e.seq, seat: e.seat, street: e.street, kind: e.kind, amount: e.amount, to: e.to, allIn: e.allIn, potBefore: e.potBefore, source: c.meta?.[e.seq]?.source, inferred: c.meta?.[e.seq]?.inferred, uncertain: c.meta?.[e.seq]?.uncertain })),
    heroSeat: c.heroSeat, heroCards: c.heroCards ? c.heroCards.map(cardStr) : null,
    heroNet: hero && h.phase === 'complete' ? hero.stack - hero.startStack : null,
    wentToShowdown: h.wentToShowdown, valid: c.valid, observedToEnd: c.observedToEnd,
    ...(c.resultCheck ? { stackCheck: toStackCheck(c.resultCheck) } : {}),
  };
}

export interface DecisionRecord {
  handId: string;
  tableId: string;
  ts: number;
  eventCount: number;
  heroCards: string[];
  board: string[];
  pot: number;
  decision: Decision;
  /** What happened to it: shown only, executed, rejected ... */
  execution: { status: string; reason: string; ms: number; timing?: ExecutionTiming } | null;
  /** The exact state the recommendation was computed for. */
  context?: RecommendationContext;
  /**
   * What happened to this recommendation, from the decision to its end (since 3.1b, schema 2; absent in records
   * written before). `execution` keeps its 0.9.1 meaning: set only when the executor was called, so a record with
   * `execution: null` and a lifecycle outcome of 'cancelled' or 'expired' is a recommendation that was NOT executed.
   */
  lifecycle?: DecisionLifecycle;
}

/** Outcome of one recommendation. */
export type LifecycleOutcome = 'recommended' | 'executed' | 'unverified' | 'rejected' | 'failed' | 'cancelled' | 'expired';

/**
 * How Hero's action at this decision point is known.
 *  bot                    the bot's executor sent it
 *  manual-click-observed  the page reported a real (user) click on one of the table's action buttons
 *  manual-inferred        the table shows a Hero action the bot did not send, but no click was seen: a click the page
 *                         did not report, a keyboard shortcut, or the site's own time-out action (indistinguishable)
 *  none                   Hero has not acted (yet) at this decision point
 *  unknown                Hero's turn ended but no Hero action was recorded for this decision point
 */
export type HeroActionEvidence = 'bot' | 'manual-click-observed' | 'manual-inferred' | 'none' | 'unknown';

export interface DecisionLifecycle {
  schema: 2;
  /** The decision opportunity (hand, street, state version): stable across repeated reads of the same state. */
  opportunity: string;
  /** Attempt number on this page; one opportunity normally has exactly one. */
  attempt: number;
  mode: Mode;
  executionPermitted: boolean;
  strategy: { selected: string; used: string; fallback: string | null };
  recommendation: { action: string; to: number | null; label: string };
  /** Scheduling plan (authorised play only). Times are ms from the start of the opportunity on the page clock. */
  schedule: null | {
    timingMode: TimingMode; targetDelayMs: number; plannedAfterMs: number; latestSafeAfterMs: number; deadlineSource: string;
    startUncertaintyMs: number; conflict: string | null; capped: string | null;
  };
  /** When the recommendation was ready, ms from the start of the opportunity. */
  readyAfterMs: number;
  /** When it was handed to the executor (null: never). */
  attemptedAfterMs: number | null;
  outcome: LifecycleOutcome;
  reason: string | null;
  heroAction: { evidence: HeroActionEvidence; kind: string | null; afterMs: number | null; detail: string };
  /** true: the table showed the action; false: not confirmed; null: nothing was sent. */
  tableConfirmed: boolean | null;
  /** Page timer health during this attempt. */
  timers: { maxLateMs: number; lateWakeups: number; clockJumpMs: number; loopGapBeforeMs: number; pageVisible: boolean | null };
  /** Ordered lifecycle events, ms from the start of the opportunity. */
  events: { afterMs: number; what: string }[];
}

/** What a recommendation belongs to. It is stale as soon as any of this changes. */
export interface RecommendationContext {
  key: string;
  handId: string;
  street: string;
  /** State version: number of reconstructed events when the decision was requested. */
  version: number;
  heroSeat: number;
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  opponents: number;
}

export interface Recommendation {
  /** off: manual mode. none: not Hero's turn. thinking / ready: for the CURRENT state. blocked: Hero's turn but suppressed. */
  state: 'off' | 'none' | 'thinking' | 'ready' | 'blocked';
  /** Why there is no recommendation (always set unless thinking / ready). */
  reason: string | null;
  context: RecommendationContext | null;
}

export type Level = 'ok' | 'warn' | 'bad' | 'na';
export interface Indicator { level: Level; detail: string }
/** Six separate answers instead of one confidence number. */
export interface Readiness {
  /** Can the extension read the required table information? */
  observation: Indicator;
  /** Does the reconstructed state agree with the available evidence? */
  consistency: Indicator;
  /** Is the current actor established reliably? */
  turn: Indicator;
  /** Are Hero's available actions known and confirmed by the buttons? */
  legal: Indicator;
  /** Can a recommendation be produced safely right now? */
  decision: Indicator;
  /** How reliable are the equity and EV estimates behind the recommendation? */
  strategy: Indicator;
}

/** `tableId` is set by the table tab that wrote the line (absent on lines written before 0.7.0). */
export interface DiagnosticRecord { ts: number; level: 'info' | 'warn' | 'error'; source: string; message: string; data?: unknown; tableId?: string }

/** Snapshot pushed to the dashboard a few times per second. */
export interface LiveState {
  ts: number;
  tableId: string;
  mode: Mode;
  acting: boolean;
  estop: boolean;
  status: string;
  observation: { health: Record<string, boolean>; problems: string[]; heroToAct: boolean; timeRemainingMs: number | null };
  tracker: {
    valid: boolean;
    /** Heuristic score in 0..1, NOT a probability. */
    confidence: number;
    unsupported: boolean; issues: string[]; waitingReason: string | null; handsSeen: number;
    phase: string; consistency: string; settled: boolean; blockers: string[]; warnings: string[];
    observedActor: number | null; predictedActor: number | null; turnStatus: string; heroStatus: string;
    legal: { status: string; detail: string | null; context?: { street: string; heroStreetCommit: number; currentBet: number; toCall: number; controls: string[]; wagerLabel: string | null; presets: number[] } };
    discrepancies: { ts: number; kind: string; message: string; street: string; eventCount: number; blocking: boolean }[];
  };
  recommendation: Recommendation;
  readiness: Readiness;
  recorder: { enabled: boolean; recorded: number; dropped: number };
  participation: SeatParticipation[];
  timeline: TimelineEntry[];
  hand: null | {
    handId: string; street: string; phase: string; board: string[]; pot: number; heroSeat: number | null; heroCards: string[] | null;
    heroPosition: string | null; effectiveStackBB: number | null; bigBlind: number; smallBlind: number; heroStack: number | null;
    counts: { seated: number; dealtIn: number; contesting: number; allIn: number; canAct: number; opponentsContesting: number; potType: string; headsUpTable: boolean } | null;
    players: { seat: number; name: string; playerId: string; position: string | null; stack: number; streetCommit: number; folded: boolean; allIn: boolean; toAct: boolean }[];
  };
  decision: Decision | null;
  lastExecution: { status: string; reason: string; ms: number; action: string } | null;
  deadlineMs: number | null;
  /** Selected strategy and, for version 3, the fitted tables (absent in states written before 0.9.0). */
  strategy?: StrategyView;
  /** Shadow comparison for the current decision point (diagnostic only; absent unless enabled). */
  shadow?: ShadowComparison | null;
  /** Whether execution is enabled on this table, and why not (absent in states written before 0.9.1). */
  execution?: { enabled: boolean; reason: string };
  /** Authorised-play scheduling: the pending action, its timing, the last cancellation (absent before 0.9.1). */
  schedule?: ScheduleView;
  /** Whether the page's timers can be trusted right now (absent before 3.1b). */
  timing?: TimingHealth;
}

/** Page timer health: browsers delay timers in background tabs, which makes on-time execution impossible. */
export interface TimingHealth {
  /** document.visibilityState === 'visible' (null: unknown). */
  pageVisible: boolean | null;
  /** Gap between the last two reads of the table (normally about 250 ms). */
  lastLoopGapMs: number;
  /** Largest gap in the last minute. */
  recentMaxGapMs: number;
  /** Delayed timers were seen in the last minute. */
  throttled: boolean;
  /** Shown when autonomous play is armed and on-time execution cannot be relied on; null otherwise. */
  warning: string | null;
}

/** How one executed action was timed. Computation is part of the delay, not added to it. */
export interface ExecutionTiming {
  targetDelayMs: number;
  /** From the confirmed opportunity to the click. */
  actualDelayMs: number;
  computeMs: number;
  waitedMs: number;
  deadlineSource: string;
  conflict: string | null;
  capped: string | null;
  /** Attempt identity (3.1b): the timing above belongs to this attempt only. */
  attempt?: number;
  /** Largest lateness of one of this attempt's timer wake-ups (3.1b). */
  maxTimerLateMs?: number;
}

export interface ScheduleView {
  policy: { timingMode: TimingMode; minDelayMs: number; maxDelayMs: number; deadlineMarginMs: number; assumedClockMs: number };
  /** The action waiting to be executed for the current decision point, if any. */
  pending: null | {
    key: string; label: string; decidedBy: string; fallback: string | null; state: 'waiting' | 'executing';
    targetDelayMs: number; computeMs: number; remainingMs: number; deadlineInMs: number; deadlineSource: string;
    conflict: string | null; capped: string | null;
  };
  lastCancel: { label: string | null; reason: string; agoMs: number; kind?: 'cancelled' | 'expired' } | null;
  lastExecuted: { label: string; reason: string; delayMs: number; computeMs: number; waitedMs: number; conflict: string | null; agoMs: number } | null;
}

export type BotMessage =
  | { type: 'bot/live'; live: LiveState }
  | { type: 'bot/hand'; hand: HandRecord; profiles: PlayerProfile[] }
  | { type: 'bot/handCheck'; check: ResultCheck }
  | { type: 'bot/decision'; record: DecisionRecord }
  | { type: 'bot/diag'; record: DiagnosticRecord }
  | { type: 'bot/frames'; frames: DebugFrame[] }
  | { type: 'bot/loadProfiles'; ids: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Strict structural check of an incoming message. Anything else is ignored by the receiver. */
export function parseBotMessage(raw: unknown): BotMessage | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'bot/live': return isObj(raw.live) && typeof raw.live.tableId === 'string' && typeof raw.live.ts === 'number' ? (raw as unknown as BotMessage) : null;
    case 'bot/hand': return isObj(raw.hand) && typeof raw.hand.handId === 'string' && Array.isArray(raw.hand.events) && Array.isArray(raw.profiles) && raw.profiles.length <= 12 ? (raw as unknown as BotMessage) : null;
    case 'bot/handCheck': return isObj(raw.check) && typeof raw.check.handId === 'string' && raw.check.handId.length < 300 && ['confirmed', 'top-up', 'awarded-differently', 'unexplained', 'unavailable'].includes(raw.check.status as string) && typeof raw.check.note === 'string' && raw.check.note.length < 1000 && (raw.check.heroDiff === null || typeof raw.check.heroDiff === 'number') ? (raw as unknown as BotMessage) : null;
    case 'bot/decision': return isObj(raw.record) && typeof raw.record.handId === 'string' && isObj(raw.record.decision) ? (raw as unknown as BotMessage) : null;
    case 'bot/diag': return isObj(raw.record) && typeof raw.record.message === 'string' && raw.record.message.length < 2000 ? (raw as unknown as BotMessage) : null;
    case 'bot/frames': return Array.isArray(raw.frames) && raw.frames.length <= 60 && raw.frames.every((f) => isObj(f) && isObj(f.obs) && typeof f.wall === 'number' && typeof f.n === 'number') ? (raw as unknown as BotMessage) : null;
    case 'bot/loadProfiles': return Array.isArray(raw.ids) && raw.ids.length <= 12 && raw.ids.every((i) => typeof i === 'string' && i.length < 200) ? (raw as unknown as BotMessage) : null;
    default: return null;
  }
}
