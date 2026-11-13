// ============================================================
// Offline replay of recorded observations (debug bundles).
//
// The recorded observations are fed, in order and with their original
// timestamps, through a fresh HandTracker: the same code that ran live. The
// result shows, per frame, the observed and predicted actor, the actions the
// reconstruction added (and whether each was displayed or deduced), every
// blocker, and where today's code behaves differently from the recording.
// ============================================================

import type { TableObs } from '../adapter/observation';
import { HandTracker } from '../adapter/tracker';
import type { DebugFrame } from './recorder';
import { buildTimeline, formatTimeline, TimelineEntry } from './timeline';

export interface ReplayStep {
  index: number;
  n: number | null;
  ts: number;
  handId: string | null;
  phase: string;
  observedActor: number | null;
  predictedActor: number | null;
  turnStatus: string;
  heroStatus: string;
  heroToActShown: boolean;
  eventCount: number;
  valid: boolean;
  settled: boolean;
  blockers: string[];
  warnings: string[];
  newEvents: TimelineEntry[];
  /** How this replay differs from what was recorded live for the same frame (null when identical or nothing recorded). */
  differsFromRecording: string | null;
}

export interface ReplayHand {
  handId: string;
  timeline: TimelineEntry[];
  timelineText: string;
  valid: boolean;
  completed: boolean;
  deduced: number;
  /** First frame at which the reconstruction and the table disagreed (after the table had settled). */
  firstDivergence: { index: number; n: number | null; message: string } | null;
  discrepancies: { index: number; message: string }[];
}

export interface ReplayResult {
  steps: ReplayStep[];
  hands: ReplayHand[];
  framesWithHeroTurnShown: number;
  /** Hero-turn frames where the reconstruction was usable (valid, no blocker, actor agreed). */
  framesHeroTurnUsable: number;
  /** Hero-turn frames that were settled but blocked. */
  framesHeroTurnBlocked: number;
  changedVersusRecording: number;
}

export function replayObservations(input: readonly ({ obs: TableObs } & Partial<DebugFrame>)[], tracker: HandTracker = new HandTracker()): ReplayResult {
  const steps: ReplayStep[] = [];
  const hands = new Map<string, ReplayHand>();
  let lastHand: string | null = null, lastCount = 0;
  let shown = 0, usable = 0, blocked = 0, changed = 0;
  input.forEach((f, index) => {
    tracker.ingest(f.obs);
    const st = tracker.state;
    const h = st.hand;
    const handId = h?.handId ?? null;
    if (handId !== lastHand) { lastHand = handId; lastCount = 0; }
    const newEvents = h ? buildTimeline(h, st.meta, lastCount) : [];
    lastCount = st.eventCount;
    let differs: string | null = null;
    const rec = f.tracker;
    if (rec) {
      const d: string[] = [];
      if (rec.predictedActor !== st.predictedActor) d.push(`predicted actor ${String(rec.predictedActor)} -> ${String(st.predictedActor)}`);
      if (rec.eventCount !== st.eventCount) d.push(`events ${rec.eventCount} -> ${st.eventCount}`);
      if (rec.valid !== st.valid) d.push(`valid ${String(rec.valid)} -> ${String(st.valid)}`);
      if ((rec.blockers.length > 0) !== (st.blockers.length > 0)) d.push(`blocked ${String(rec.blockers.length > 0)} -> ${String(st.blockers.length > 0)}`);
      if (d.length) { differs = d.join(', '); changed++; }
    }
    steps.push({
      index, n: f.n ?? null, ts: f.obs.ts, handId, phase: st.phase, observedActor: st.observedActor, predictedActor: st.predictedActor, turnStatus: st.turnStatus,
      heroStatus: st.heroStatus, heroToActShown: f.obs.heroToAct, eventCount: st.eventCount, valid: st.valid, settled: st.settled,
      blockers: st.blockers, warnings: st.warnings, newEvents, differsFromRecording: differs,
    });
    if (f.obs.heroToAct) {
      shown++;
      if (h && st.valid && st.blockers.length === 0 && st.heroSeat !== null && h.toAct === st.heroSeat) usable++;
      else if (st.settled) blocked++;
    }
    if (h && handId) {
      let rh = hands.get(handId);
      if (!rh) { rh = { handId, timeline: [], timelineText: '', valid: true, completed: false, deduced: 0, firstDivergence: null, discrepancies: [] }; hands.set(handId, rh); }
      rh.timeline = buildTimeline(h, st.meta);
      rh.valid = st.valid;
      rh.completed = h.phase === 'complete';
      rh.deduced = rh.timeline.filter((e) => e.inferred).length;
      const msgs = !st.valid ? [st.issues.filter((i) => i.startsWith('INVALID')).pop() ?? 'reconstruction invalid'] : st.settled ? st.blockers : [];
      for (const m of msgs) {
        if (!rh.discrepancies.some((x) => x.message === m)) rh.discrepancies.push({ index, message: m });
        if (!rh.firstDivergence) rh.firstDivergence = { index, n: f.n ?? null, message: m };
      }
    }
  });
  for (const rh of hands.values()) rh.timelineText = formatTimeline(rh.timeline);
  return { steps, hands: [...hands.values()], framesWithHeroTurnShown: shown, framesHeroTurnUsable: usable, framesHeroTurnBlocked: blocked, changedVersusRecording: changed };
}

/** Human-readable report of a replay (used by the CLI). */
export function formatReplay(r: ReplayResult): string {
  const out: string[] = [];
  for (const h of r.hands) {
    out.push(`=== ${h.handId} | ${h.valid ? 'valid' : 'INVALID'} | ${h.completed ? 'complete' : 'not completed'} | ${h.deduced} deduced action(s)`);
    out.push(h.timelineText || '(no actions)');
    if (h.firstDivergence) out.push(`FIRST DIVERGENCE at frame #${h.firstDivergence.index}${h.firstDivergence.n !== null ? ` (recorded n=${h.firstDivergence.n})` : ''}: ${h.firstDivergence.message}`);
    for (const d of h.discrepancies.slice(1)) out.push(`  also at frame #${d.index}: ${d.message}`);
    out.push('');
  }
  out.push(`Hero's turn was shown in ${r.framesWithHeroTurnShown} frame(s): reconstruction usable in ${r.framesHeroTurnUsable}, blocked (after settling) in ${r.framesHeroTurnBlocked}.`);
  if (r.changedVersusRecording) {
    out.push(`${r.changedVersusRecording} frame(s) replay differently from the live recording (the code has changed since, or the live run saw extra reads):`);
    for (const s of r.steps.filter((x) => x.differsFromRecording).slice(0, 30)) out.push(`  frame #${s.index}: ${s.differsFromRecording}`);
  }
  return out.join('\n');
}
