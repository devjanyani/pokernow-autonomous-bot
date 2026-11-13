// ============================================================
// Local live-hand diagnostic recorder and debug-bundle format.
//
// One DebugFrame is kept per MEANINGFUL change: the normalised observation
// (exactly what the page showed the player), what the tracker made of it, the
// actions it added, and what happened to the recommendation. Frames are plain
// JSON, stored only in the extension's own IndexedDB, exported on request from
// the dashboard, and never sent anywhere.
//
// A frame holds nothing the player could not see: no cookies, tokens, page
// URLs beyond the table id, hidden cards or network data.
// ============================================================

import { cardStr } from '../cards';
import type { TableObs } from '../adapter/observation';
import { obsSignature, SeatParticipation, TrackerState } from '../adapter/tracker';
import { potTotal } from '../table/engine';
import type { LegalActions } from '../table/engine';
import { buildTimeline, TimelineEntry } from './timeline';

export const BUNDLE_FORMAT = 'poker-bot-debug-bundle';
export const BUNDLE_VERSION = 1;

export interface FrameDecision {
  /** off: manual mode. none: not Hero's turn. thinking / ready: a recommendation for THIS state. blocked: Hero's turn, recommendation suppressed. */
  state: 'off' | 'none' | 'thinking' | 'ready' | 'blocked';
  reason: string | null;
  key: string | null;
  label: string | null;
  action: string | null;
  to: number | null;
}

export interface FrameTracker {
  handId: string | null;
  phase: string;
  street: string | null;
  eventCount: number;
  valid: boolean;
  /** Heuristic score, not a probability. */
  confidence: number;
  consistency: string;
  settled: boolean;
  observedActor: number | null;
  predictedActor: number | null;
  turnStatus: string;
  heroSeat: number | null;
  heroStatus: string;
  heroCards: string[] | null;
  board: string[];
  pot: number | null;
  buttonSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  blockers: string[];
  warnings: string[];
  waitingReason: string | null;
  legal: { status: string; detail: string | null; actions: LegalActions | null };
  participation: SeatParticipation[];
}

export interface DebugFrame {
  /** Random id of the page session that recorded the frame. */
  session: string;
  /** Sequence number within the session; a gap means frames were dropped before storage. */
  n: number;
  /** Observation clock (ms, monotonic within the session). */
  ts: number;
  /** Wall-clock time (ms since epoch). */
  wall: number;
  handKey: string | null;
  obs: TableObs;
  tracker: FrameTracker;
  /** Actions added to the reconstruction by this observation. */
  events: TimelineEntry[];
  decision: FrameDecision;
}

export function frameTracker(st: TrackerState): FrameTracker {
  const h = st.hand;
  return {
    handId: h?.handId ?? null, phase: st.phase, street: h?.street ?? null, eventCount: st.eventCount, valid: st.valid, confidence: st.confidence,
    consistency: st.consistency, settled: st.settled, observedActor: st.observedActor, predictedActor: st.predictedActor, turnStatus: st.turnStatus,
    heroSeat: st.heroSeat, heroStatus: st.heroStatus, heroCards: st.heroCards ? st.heroCards.map(cardStr) : null, board: h ? h.board.map(cardStr) : [],
    pot: h ? (h.phase === 'complete' ? 0 : potTotal(h)) : null, buttonSeat: h?.buttonSeat ?? null,
    smallBlindSeat: h?.seats.find((s) => s.pos?.isSmallBlind)?.seat ?? null, bigBlindSeat: h?.seats.find((s) => s.pos?.isBigBlind)?.seat ?? null,
    blockers: st.blockers, warnings: st.warnings, waitingReason: st.waitingReason,
    legal: st.legal, participation: st.participation,
  };
}

export class FrameRecorder {
  private n = 0;
  private lastKey = '';
  private lastHand: string | null = null;
  private lastEventCount = 0;
  private pending: DebugFrame[] = [];
  /** Frames discarded because they could not be handed to storage in time. */
  dropped = 0;
  recorded = 0;

  constructor(private readonly session: string, private readonly wallNow: () => number = () => Date.now(), private readonly maxPending = 300) {}

  /** Record the state after one observation. Returns the frame, or null when nothing meaningful changed. */
  record(obs: TableObs, st: TrackerState, decision: FrameDecision): DebugFrame | null {
    const key = [obsSignature(obs), st.hand?.handId ?? '', st.eventCount, st.valid, st.turnStatus, st.blockers.join(';'), st.warnings.join(';'), st.waitingReason ?? '',
      decision.state, decision.reason ?? '', decision.key ?? '', decision.label ?? '', obs.problems.join(';')].join('#');
    if (key === this.lastKey) return null;
    this.lastKey = key;
    const handId = st.hand?.handId ?? null;
    if (handId !== this.lastHand) { this.lastHand = handId; this.lastEventCount = 0; }
    const events = st.hand ? buildTimeline(st.hand, st.meta, this.lastEventCount) : [];
    this.lastEventCount = st.eventCount;
    const frame: DebugFrame = { session: this.session, n: this.n++, ts: obs.ts, wall: this.wallNow(), handKey: handId, obs, tracker: frameTracker(st), events, decision };
    this.pending.push(frame);
    this.recorded++;
    if (this.pending.length > this.maxPending) { this.pending.shift(); this.dropped++; }
    return frame;
  }

  get pendingCount(): number { return this.pending.length; }
  drain(max = 40): DebugFrame[] { return this.pending.splice(0, max); }
}

// ---- bundle -----------------------------------------------------------------

export interface BundleHand {
  handKey: string | null;
  firstWall: number;
  lastWall: number;
  /** False when the stored frames do not start at the hand's first observation (older frames were dropped). */
  startsAtHandStart: boolean;
  frames: DebugFrame[];
}

export interface DebugBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  build: { extensionVersion: string; userAgent: string | null };
  settings: Record<string, unknown>;
  anonymised: boolean;
  /** What is missing from this bundle and why. */
  dropped: { framesPrunedFromStorage: number; framesDroppedBeforeStorage: number; sequenceGaps: number; note: string };
  hands: BundleHand[];
  /** Stored hand summaries, decisions and log lines that belong to the exported hands (when available). */
  handRecords: unknown[];
  decisions: unknown[];
  diagnostics: unknown[];
}

/** Group frames (oldest first) into hands. Frames seen while no hand was tracked lead into the hand that follows. */
export function groupFrames(frames: readonly DebugFrame[]): BundleHand[] {
  const hands: BundleHand[] = [];
  let lead: DebugFrame[] = [];
  for (const f of frames) {
    const cur = hands[hands.length - 1];
    if (f.handKey === null) { lead.push(f); continue; }
    if (cur && cur.handKey === f.handKey) { cur.frames.push(...lead, f); lead = []; cur.lastWall = f.wall; continue; }
    const first = lead[0] ?? f;
    hands.push({ handKey: f.handKey, firstWall: first.wall, lastWall: f.wall, startsAtHandStart: f.events.some((e) => e.seq === 0), frames: [...lead, f] });
    lead = [];
  }
  if (lead.length) {
    const cur = hands[hands.length - 1];
    if (cur) { cur.frames.push(...lead); cur.lastWall = lead[lead.length - 1].wall; }
    else hands.push({ handKey: null, firstWall: lead[0].wall, lastWall: lead[lead.length - 1].wall, startsAtHandStart: false, frames: lead });
  }
  return hands;
}

export interface BundleOptions {
  /** Number of most recent hands, 'all', or one hand key. */
  hands: number | 'all' | { handKey: string };
  anonymise: boolean;
  extensionVersion: string;
  userAgent?: string | null;
  settings?: Record<string, unknown>;
  framesPruned?: number;
  framesDroppedBeforeStorage?: number;
  handRecords?: { handId: string }[];
  decisions?: { handId: string }[];
  diagnostics?: unknown[];
  now?: number;
}

export function buildBundle(frames: readonly DebugFrame[], o: BundleOptions): DebugBundle {
  let hands = groupFrames(frames);
  if (typeof o.hands === 'number') hands = hands.slice(-o.hands);
  else if (o.hands !== 'all') { const k = o.hands.handKey; hands = hands.filter((h) => h.handKey === k); }
  const keys = new Set(hands.map((h) => h.handKey));
  let gaps = 0;
  for (const h of hands) for (let i = 1; i < h.frames.length; i++) if (h.frames[i].session === h.frames[i - 1].session && h.frames[i].n !== h.frames[i - 1].n + 1) gaps++;
  const pruned = o.framesPruned ?? 0, early = o.framesDroppedBeforeStorage ?? 0;
  const partial = hands.filter((h) => !h.startsAtHandStart).length;
  const bundle: DebugBundle = {
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: new Date(o.now ?? Date.now()).toISOString(),
    build: { extensionVersion: o.extensionVersion, userAgent: o.userAgent ?? null },
    settings: o.settings ?? {}, anonymised: false,
    dropped: {
      framesPrunedFromStorage: pruned, framesDroppedBeforeStorage: early, sequenceGaps: gaps,
      note: `${hands.length} hand(s) exported. ${partial ? `${partial} of them do not start at the hand's first observation. ` : ''}${gaps ? `${gaps} gap(s) in the frame sequence. ` : ''}${pruned ? `${pruned} older frame(s) were pruned from local storage over time (bounded storage). ` : ''}Frames exist only for changes seen while recording was on.`,
    },
    hands,
    handRecords: (o.handRecords ?? []).filter((r) => keys.has(r.handId)),
    decisions: (o.decisions ?? []).filter((r) => keys.has(r.handId)),
    diagnostics: o.diagnostics ?? [],
  };
  return o.anonymise ? anonymiseBundle(bundle) : bundle;
}

/** Replace player names, player ids and the table id with placeholders, everywhere they occur as text. */
export function anonymiseBundle(b: DebugBundle): DebugBundle {
  const names = new Map<string, string>();
  const tables = new Map<string, string>();
  for (const h of b.hands) for (const f of h.frames) {
    if (f.obs.tableId && !tables.has(f.obs.tableId)) tables.set(f.obs.tableId, `table-${tables.size + 1}`);
    for (const s of f.obs.seats) {
      if (s.name && !names.has(s.name)) names.set(s.name, `Player${names.size + 1}`);
      if (s.playerId && !names.has(s.playerId)) names.set(s.playerId, `pid-${names.size + 1}`);
    }
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Longest first, whole words only, so "Al" does not rewrite "All-in".
  const subs = [...tables, ...names].sort((a, b2) => b2[0].length - a[0].length)
    .map(([from, to]) => ({ from, to, re: new RegExp(`(?<![A-Za-z0-9_])${esc(from)}(?![A-Za-z0-9_])`, 'g') }));
  const fix = (s: string): string => {
    let out = s;
    for (const x of subs) { if (out === x.from) return x.to; if (out.includes(x.from)) out = out.replace(x.re, x.to); }
    return out;
  };
  // Fields whose values are vocabulary, never player text: a player called "call" must not rewrite an action kind.
  const KEEP = new Set(['kind', 'source', 'street', 'phase', 'state', 'format', 'consistency', 'turnStatus', 'heroStatus', 'status', 'position', 'level', 'session', 'exportedAt', 'extensionVersion', 'userAgent', 'gameType', 'action']);
  const walk = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') return KEEP.has(key) ? v : fix(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x, k); return o; }
    return v;
  };
  return { ...(walk(b) as DebugBundle), anonymised: true };
}

/** Structural check of a bundle read from a file. Throws with a readable message. */
export function parseBundle(raw: unknown): DebugBundle {
  const b = raw as DebugBundle;
  if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) throw new Error(`not a ${BUNDLE_FORMAT} file`);
  if (b.version !== BUNDLE_VERSION) throw new Error(`unsupported bundle version ${String(b.version)} (this build reads version ${BUNDLE_VERSION})`);
  if (!Array.isArray(b.hands)) throw new Error('bundle has no hands array');
  for (const h of b.hands) {
    if (!Array.isArray(h.frames)) throw new Error('a hand has no frames array');
    for (const f of h.frames) if (!f || typeof f !== 'object' || !f.obs || !Array.isArray(f.obs.seats) || typeof f.obs.ts !== 'number') throw new Error('a frame has no usable observation');
  }
  return b;
}
