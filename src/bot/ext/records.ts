// ============================================================
// Plain-JSON records exchanged between the content script, the background
// service worker and the dashboard, plus settings. Everything here is
// structured-clone safe (no Maps, no class instances).
// ============================================================

import { cardStr } from '../cards';
import type { CompletedHand } from '../adapter/tracker';
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
  /** Bounded think-time variation before acting (ms). Never extends past the action clock. */
  minThinkMs: number;
  maxThinkMs: number;
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
   * Strategy experiment: which engine produces recommendations. 'v2' (0.6.0, the default) or 'v1' (0.5.1).
   * Neither is shown to be better against real opponents; see docs/bot/STRATEGY_V2_DIAGNOSIS.md.
   */
  strategyEngine: 'v1' | 'v2';
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1, mode: 'recommend', estop: false, authorizationConfirmed: false, authorizedTables: [],
  exploitWeight: 1, minThinkMs: 600, maxThinkMs: 2200, assumedClockMs: 20000, minConfidence: 0.7,
  showPanel: true, timeoutAction: 'check-fold', selectorOverrides: {}, recordDiagnostics: true, strategyEngine: 'v2',
};

const clamp = (x: unknown, lo: number, hi: number, def: number): number => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

/** Validate anything read from storage or received in a message. Unknown fields are dropped. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const mode: Mode = r.mode === 'manual' || r.mode === 'recommend' || r.mode === 'autonomous' ? r.mode : d.mode;
  const minThinkMs = clamp(r.minThinkMs, 0, 10000, d.minThinkMs);
  const overrides: Record<string, string> = {};
  if (r.selectorOverrides && typeof r.selectorOverrides === 'object') {
    for (const [k, v] of Object.entries(r.selectorOverrides as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0 && v.length < 300 && /^[\w-]+$/.test(k)) overrides[k] = v;
    }
  }
  return {
    version: 1, mode, estop: r.estop === true, authorizationConfirmed: r.authorizationConfirmed === true,
    authorizedTables: Array.isArray(r.authorizedTables) ? r.authorizedTables.filter((t): t is string => typeof t === 'string' && /^[\w-]{1,80}$/.test(t)).slice(0, 50) : [],
    exploitWeight: clamp(r.exploitWeight, 0, 1, d.exploitWeight), minThinkMs,
    maxThinkMs: Math.max(minThinkMs, clamp(r.maxThinkMs, 0, 15000, d.maxThinkMs)),
    assumedClockMs: clamp(r.assumedClockMs, 3000, 120000, d.assumedClockMs),
    minConfidence: clamp(r.minConfidence, 0.4, 1, d.minConfidence),
    showPanel: r.showPanel !== false, timeoutAction: r.timeoutAction === 'nothing' ? 'nothing' : 'check-fold', selectorOverrides: overrides,
    recordDiagnostics: r.recordDiagnostics !== false, strategyEngine: r.strategyEngine === 'v1' ? 'v1' : 'v2',
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

/** True only when clicking is permitted for this table right now. */
export function mayAct(s: Settings, tableId: string): boolean {
  return s.mode === 'autonomous' && !s.estop && s.authorizationConfirmed && s.authorizedTables.includes(tableId);
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
}

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
  execution: { status: string; reason: string; ms: number } | null;
  /** The exact state the recommendation was computed for. */
  context?: RecommendationContext;
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
}

export type BotMessage =
  | { type: 'bot/live'; live: LiveState }
  | { type: 'bot/hand'; hand: HandRecord; profiles: PlayerProfile[] }
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
    case 'bot/decision': return isObj(raw.record) && typeof raw.record.handId === 'string' && isObj(raw.record.decision) ? (raw as unknown as BotMessage) : null;
    case 'bot/diag': return isObj(raw.record) && typeof raw.record.message === 'string' && raw.record.message.length < 2000 ? (raw as unknown as BotMessage) : null;
    case 'bot/frames': return Array.isArray(raw.frames) && raw.frames.length <= 60 && raw.frames.every((f) => isObj(f) && isObj(f.obs) && typeof f.wall === 'number' && typeof f.n === 'number') ? (raw as unknown as BotMessage) : null;
    case 'bot/loadProfiles': return Array.isArray(raw.ids) && raw.ids.length <= 12 && raw.ids.every((i) => typeof i === 'string' && i.length < 200) ? (raw as unknown as BotMessage) : null;
    default: return null;
  }
}
