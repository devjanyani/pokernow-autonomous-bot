// ============================================================
// Presentation model shared by the dashboard and the in-page overlay.
//
// Pure functions from LiveState to what is shown. Nothing here computes or
// alters poker values: every number comes from the live state as is, and a
// value that does not exist (no equity, no recommendation) is shown as absent.
// ============================================================

import type { LiveState } from './records';

export type Tone = 'good' | 'warn' | 'bad' | 'muted' | 'accent';

export interface CardView { rank: string; suit: string; red: boolean; label: string }
const SUITS: Record<string, [string, string, boolean]> = { h: ['♥', 'hearts', true], d: ['♦', 'diamonds', true], c: ['♣', 'clubs', false], s: ['♠', 'spades', false] };
const RANK_NAMES: Record<string, string> = { A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: 'ten' };

/** "Qc" -> queen of clubs. Unknown text yields a blank face rather than a guess. */
export function cardView(c: string): CardView {
  const r = c.charAt(0).toUpperCase(), s = SUITS[c.charAt(1).toLowerCase()];
  if (c.length !== 2 || !s || !'23456789TJQKA'.includes(r)) return { rank: '?', suit: '', red: false, label: 'unreadable card' };
  return { rank: r === 'T' ? '10' : r, suit: s[0], red: s[2], label: `${RANK_NAMES[r] ?? r} of ${s[1]}` };
}

/** Chips without float noise. */
export function chips(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  return (Math.round(x * 100) / 100).toLocaleString('en-US');
}

export type StatusLabel = 'Ready' | 'Waiting' | 'Reconnecting' | 'Needs attention' | 'Paused';
export interface StatusPill { label: StatusLabel; tone: Tone; detail: string }

/** Live states older than this are treated as a lost connection to the table tab. */
export const STALE_MS = 6000;

/** One compact status for the whole system. The details stay on the Diagnostics tab. */
export function statusPill(l: LiveState | null, now: number): StatusPill {
  if (!l) return { label: 'Waiting', tone: 'muted', detail: 'Open a PokerNow table in another tab.' };
  if (now - l.ts > STALE_MS) return { label: 'Reconnecting', tone: 'warn', detail: 'No update from the table tab. Reload it if this persists.' };
  if (l.estop) return { label: 'Paused', tone: 'warn', detail: 'Emergency stop is on: nothing will be clicked. Tracking continues.' };
  if (l.mode === 'manual') return { label: 'Paused', tone: 'muted', detail: 'Manual mode: observing only.' };
  const r = l.readiness;
  const bad = [r.observation, r.consistency, r.turn, r.legal].find((i) => i.level === 'bad');
  if (l.recommendation.state === 'blocked') return { label: 'Needs attention', tone: 'bad', detail: l.recommendation.reason ?? 'The table state could not be confirmed.' };
  if (bad) return { label: 'Needs attention', tone: 'bad', detail: bad.detail };
  if (l.tracker.unsupported) return { label: 'Needs attention', tone: 'bad', detail: 'This is not a No-Limit Hold\'em table.' };
  if (!l.hand) return { label: 'Waiting', tone: 'muted', detail: 'Waiting for a hand to start.' };
  return { label: 'Ready', tone: 'good', detail: l.acting ? 'Tracking the hand. Acting automatically on this table.' : 'Tracking the hand. Recommendations only.' };
}

export interface Banner {
  /** action: a recommendation for the current decision. message: why there is none. */
  kind: 'action' | 'message';
  title: string;
  sub: string;
  tone: Tone;
  /** Still being refined. */
  provisional: boolean;
}

/** FOLD / CHECK / CALL 7 / BET 56 / RAISE TO 24 / ALL-IN 97, from the decision exactly as computed. */
export function actionTitle(l: LiveState): string | null {
  const d = l.decision, c = l.recommendation.context;
  if (!d) return null;
  const hero = l.hand?.players.find((p) => p.seat === l.hand?.heroSeat);
  switch (d.action) {
    case 'fold': return 'FOLD';
    case 'check': return 'CHECK';
    case 'call': return c && hero && c.toCall >= hero.stack - 1e-9 ? `ALL-IN (call ${chips(c.toCall)})` : `CALL ${c ? chips(c.toCall) : ''}`.trim();
    case 'bet':
    case 'raise': {
      if (c && d.to !== undefined && d.to >= c.maxRaiseTo - 1e-9) return `ALL-IN ${chips(d.to)}`;
      return `${d.action === 'bet' ? 'BET' : 'RAISE TO'} ${chips(d.to)}`;
    }
    default: return String(d.action).toUpperCase();
  }
}

function nameOf(l: LiveState, seat: number | null): string {
  if (seat === null) return 'nobody';
  const p = l.participation.find((x) => x.seat === seat);
  if (!p) return `seat ${seat}`;
  return p.isHero ? 'you' : p.name;
}

/** Whose turn it is, and whether the table and the reconstruction agree on it. */
export function actorLine(l: LiveState): { text: string; verified: boolean; tone: Tone } {
  const t = l.tracker;
  if (!l.hand || l.hand.phase === 'complete') return { text: 'Nobody to act', verified: false, tone: 'muted' };
  const pos = (seat: number | null) => { const p = l.participation.find((x) => x.seat === seat); return p?.position ? ` (${p.position})` : ''; };
  if (t.turnStatus === 'agree') return { text: `${t.predictedActor === l.hand.heroSeat ? 'Your turn' : `${nameOf(l, t.predictedActor)}${pos(t.predictedActor)} to act`}`, verified: true, tone: t.predictedActor === l.hand.heroSeat ? 'accent' : 'muted' };
  if (t.turnStatus === 'disagree') return { text: `Unclear: table shows ${nameOf(l, t.observedActor)}, tracker expects ${nameOf(l, t.predictedActor)}`, verified: false, tone: 'bad' };
  if (t.predictedActor !== null) return { text: `${nameOf(l, t.predictedActor) === 'you' ? 'You' : nameOf(l, t.predictedActor)}${pos(t.predictedActor)} next`, verified: false, tone: 'muted' };
  if (l.hand.phase === 'showdown') return { text: 'Showdown', verified: false, tone: 'muted' };
  return { text: 'Dealing the next card', verified: false, tone: 'muted' };
}

/** The decision area is never blank: a recommendation, or a plain statement of why there is none. */
export function decisionBanner(l: LiveState | null, now: number): Banner {
  const msg = (title: string, sub = '', tone: Tone = 'muted'): Banner => ({ kind: 'message', title, sub, tone, provisional: false });
  if (!l) return msg('Reading table information.', 'No PokerNow table is connected yet.');
  if (now - l.ts > STALE_MS) return msg('Reconnecting.', 'The table tab has stopped sending updates.', 'warn');
  if (l.mode === 'manual') return msg('Bot paused.', 'Manual mode: the table is observed, no recommendations are made.');
  const rec = l.recommendation;
  const title = actionTitle(l);
  if ((rec.state === 'ready' || rec.state === 'thinking') && title) {
    const c = rec.context;
    const facing = c ? (c.canCheck ? 'Check is free' : `${chips(c.toCall)} to call`) : '';
    return { kind: 'action', title, sub: [facing, l.estop ? 'Bot paused: nothing will be clicked' : ''].filter(Boolean).join(' · '), tone: 'accent', provisional: !!l.decision?.provisional };
  }
  if (rec.state === 'thinking') return msg('Thinking…', 'Working out your decision.', 'accent');
  if (rec.state === 'blocked') {
    const turn = l.tracker.turnStatus === 'disagree' || /turn|expects/i.test(rec.reason ?? '');
    return msg(turn ? 'Decision unavailable — turn tracking mismatch.' : 'Decision unavailable — table state not confirmed.', rec.reason ?? '', 'bad');
  }
  if (l.tracker.unsupported) return msg('Decision unavailable.', 'This is not a No-Limit Hold\'em table.', 'bad');
  if (/^Reading the table/.test(l.status)) return msg('Reading table information.', 'Waiting for the table to finish updating.');
  switch (l.tracker.heroStatus) {
    case 'folded': return msg('You folded.', 'Waiting for the next hand.');
    case 'all-in': return msg('You\'re all-in.', 'No further decisions this hand.');
    case 'no-hand': return l.tracker.phase === 'initialising' ? msg('Reading table information.', 'A new hand is starting.') : msg('Waiting for the next hand.', l.estop ? 'Bot paused: nothing will be clicked.' : '');
    case 'hand-over': return msg('Waiting for the next hand.', 'This hand is complete.');
    case 'not-dealt-in': return msg('Waiting for the next hand.', 'You are not dealt in to this hand.');
    case 'showdown': return msg('Showdown.', '');
    default: return msg('Waiting for your turn.', actorLine(l).text);
  }
}

export type PlayerKind = 'acting' | 'active' | 'folded' | 'all-in' | 'not-dealt' | 'sitting-out' | 'left';
export interface PlayerRow {
  seat: number; name: string; isHero: boolean; position: string; stack: string;
  /** Last action this hand ("Raise to 8"), blank when none. */
  lastAction: string;
  status: string;
  kind: PlayerKind;
}

export function playerRows(l: LiveState): PlayerRow[] {
  const last = new Map<number, string>();
  for (const e of l.timeline) if (!e.kind.startsWith('post')) last.set(e.seat, `${e.text.slice(e.text.indexOf(': ') + 2)}${e.inferred ? ' (deduced)' : ''}`);
  for (const e of l.timeline) if (e.kind.startsWith('post') && !last.has(e.seat)) last.set(e.seat, e.text.slice(e.text.indexOf(': ') + 2).replace('Posts ', '').replace(/^./, (c) => c.toUpperCase()));
  const over = !l.hand || l.hand.phase === 'complete';
  const actor = l.tracker.turnStatus === 'disagree' ? null : l.tracker.predictedActor;
  return l.participation.map((p) => {
    let kind: PlayerKind, status: string;
    if (p.left) { kind = 'left'; status = 'Left the table'; }
    else if (!p.dealtIn) { kind = p.sittingOut ? 'sitting-out' : 'not-dealt'; status = p.sittingOut ? 'Sitting out' : 'Not in this hand'; }
    else if (p.folded) { kind = 'folded'; status = 'Folded'; }
    else if (p.allIn) { kind = 'all-in'; status = 'All-in'; }
    else if (!over && p.seat === actor) { kind = 'acting'; status = l.tracker.turnStatus === 'agree' ? 'To act' : 'Next to act'; }
    else { kind = 'active'; status = over ? '' : 'In hand'; }
    if (p.disconnected && !p.left) status = status ? `${status} · away` : 'Away';
    return { seat: p.seat, name: p.name, isHero: p.isHero, position: p.position ?? '', stack: chips(p.stack), lastAction: p.dealtIn ? last.get(p.seat) ?? '' : '', status, kind };
  });
}

/** Pot, price, blinds and who is left. */
export function contextRows(l: LiveState): [string, string][] {
  const h = l.hand;
  if (!h) return [];
  const c = l.recommendation.context;
  const rows: [string, string][] = [['Pot', `${chips(h.pot)}${h.bigBlind ? ` · ${(h.pot / h.bigBlind).toFixed(1)} bb` : ''}`]];
  if (c) rows.push(['To call', c.canCheck ? 'Nothing (check is free)' : chips(c.toCall)]);
  rows.push(['Blinds', `${chips(h.smallBlind)} / ${chips(h.bigBlind)}`]);
  if (h.counts) {
    rows.push(['Opponents in hand', String(h.counts.opponentsContesting)]);
    rows.push(['Situation', h.counts.headsUpTable ? 'Heads-up table' : h.counts.potType === 'heads-up' ? `Heads-up pot (${h.counts.dealtIn} dealt in)` : h.counts.potType === 'multiway' ? `Multiway pot (${h.counts.contesting} players)` : 'Uncontested']);
  }
  return rows;
}

/** Why the engine chose the action, in its own words. Empty when there is no recommendation. */
export function explanation(l: LiveState, brief = false): string[] {
  const d = l.decision;
  if (!d) return [];
  const out: string[] = [];
  if (d.equity) out.push(`Estimated equity ${(100 * d.equity.equity).toFixed(1)}% (± ${(196 * d.equity.stdErr).toFixed(1)}) against ${d.equity.opponents} opponent${d.equity.opponents === 1 ? '' : 's'}, from ${d.equity.samples} simulated deals.`);
  // Brief: leave out the engine's notes about its own timing and model files (they stay in the full list).
  for (const b of d.basis) if (!brief || !/^(time|heuristic|safety):/i.test(b)) out.push(b.charAt(0).toUpperCase() + b.slice(1));
  for (const a of d.adjustments) out.push(a.charAt(0).toUpperCase() + a.slice(1));
  if (d.uncertainty) out.push(d.uncertainty.charAt(0).toUpperCase() + d.uncertainty.slice(1));
  return out;
}

const ENGINE_NAMES: Record<string, string> = { v1: 'Version 1', v2: 'Version 2', v3: 'Version 3 (experimental)' };

/**
 * Which strategy is active, and, for the current recommendation, which engine actually decided it. A version 3
 * recommendation that fell back to version 2 says so, with the reason.
 */
export function strategyTag(l: LiveState | null): { text: string; tone: Tone; detail: string; fallback: boolean } | null {
  if (!l || !l.strategy) return null;
  const s = l.strategy;
  const name = ENGINE_NAMES[s.selected] ?? s.selected;
  const note = l.decision?.strategy;
  const ro = s.recommendOnly ? ' Recommendation-only: nothing is clicked while it is selected.'
    : s.v3Execution ? ` Experimental version 3 execution permission is on: ${l.acting ? 'acting on this authorised table' : `not acting here (${l.execution?.reason ?? 'not permitted'})`}.` : '';
  if (note && note.requested !== note.used) {
    return { text: `${s.selected} → ${note.used} fallback`, tone: 'warn', fallback: true, detail: `${name} selected; this recommendation came from ${ENGINE_NAMES[note.used] ?? note.used}: ${note.fallback ?? 'no reason given'}.${ro}` };
  }
  if (s.selected === 'v3') {
    const model = note?.opponentModel ? ` Opponent model: ${note.opponentModel}.` : '';
    return { text: 'v3 experimental', tone: 'accent', fallback: false, detail: `${name}.${model}${ro}` };
  }
  return { text: s.selected, tone: 'muted', fallback: false, detail: `${name}${s.selected === 'v2' ? ' (default)' : ''}.${s.shadowV3 ? ' Shadow comparison with version 3 is on (diagnostic only).' : ''}` };
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The timing mode in a few words ("Instant", "Random 4.0 s–20.0 s"). States written by 0.9.1 had `randomDelay`. */
export function timingModeText(p: { timingMode?: string; randomDelay?: boolean; minDelayMs: number; maxDelayMs: number }): string {
  const mode = p.timingMode ?? (p.randomDelay === false && p.minDelayMs === 0 ? 'instant' : 'random');
  return mode === 'instant' ? 'Instant' : `Random ${sec(p.minDelayMs)}–${sec(p.maxDelayMs)}`;
}

/** Whether execution is enabled on this table, in one line. */
export function executionLine(l: LiveState | null): { text: string; tone: Tone } | null {
  if (!l || !l.execution) return null;
  const v3 = l.strategy?.selected === 'v3';
  const mode = l.schedule ? ` · timing: ${timingModeText(l.schedule.policy)}` : '';
  return l.execution.enabled
    ? { text: `Execution enabled${v3 ? ' (version 3, experimental)' : ''}${mode}`, tone: 'warn' }
    : { text: `Execution off: ${l.execution.reason}`, tone: 'muted' };
}

/**
 * Authorised-play scheduling: the pending action and its remaining delay, the policy, the last cancellation and the
 * last executed action with its timing (computation and intentional waiting shown separately).
 */
export function scheduleRows(l: LiveState | null): [string, string][] {
  const sc = l?.schedule;
  if (!l || !sc) return [];
  const p = sc.policy;
  const rows: [string, string][] = [
    ['Execution', executionLine(l)?.text ?? '–'],
    ['Timing mode', timingModeText(p)],
    ['Timing policy', `${p.timingMode === 'instant' ? 'no intentional waiting: acts as soon as the recommendation is ready and has passed every check' : `random ${sec(p.minDelayMs)}–${sec(p.maxDelayMs)} per decision, same for every action`} · act ≥ ${sec(p.deadlineMarginMs)} before the deadline · no clock shown: assume ${sec(p.assumedClockMs)}`],
  ];
  const q = sc.pending;
  if (q) {
    rows.push(['Pending action', `${q.label}${q.fallback ? ` (decided by ${q.decidedBy}: ${q.fallback})` : ` (decided by ${q.decidedBy})`} · ${q.state === 'executing' ? 'executing now' : `in ${sec(q.remainingMs)}`}`]);
    rows.push(['Its timing', `drawn delay ${sec(q.targetDelayMs)} · computation ${sec(q.computeMs)} · deadline in ${sec(Math.max(0, q.deadlineInMs))} (${q.deadlineSource})`]);
    if (q.conflict) rows.push(['Deadline conflict', q.conflict]);
    else if (q.capped) rows.push(['Shortened', q.capped]);
  } else rows.push(['Pending action', 'none']);
  if (sc.lastCancel) rows.push(['Last cancelled', `${sc.lastCancel.label ?? 'pending action'}: ${sc.lastCancel.reason} (${sec(sc.lastCancel.agoMs)} ago)`]);
  if (sc.lastExecuted) {
    const e = sc.lastExecuted;
    rows.push(['Last executed', `${e.label} · ${e.reason} · ${sec(e.delayMs)} after the turn was confirmed (computation ${sec(e.computeMs)}, waiting ${sec(e.waitedMs)})${e.conflict ? ` · deadline conflict: ${e.conflict}` : ''} · ${sec(e.agoMs)} ago`]);
  }
  return rows;
}

/** Shadow comparison rows (diagnostic only). EVs come from different value models and are not comparable. */
export function shadowRows(l: LiveState | null): [string, string][] {
  const sh = l?.shadow;
  if (!sh) return [];
  const ev = (x: number | null) => (x === null ? 'no EV' : `${x >= 0 ? '+' : ''}${x.toFixed(1)} chips`);
  const rows: [string, string][] = [['Version 2 (selected)', `${sh.v2.label} · own estimate ${ev(sh.v2.ev)}`]];
  if (!sh.v3) rows.push(['Version 3 (shadow)', sh.note ?? 'not computed']);
  else {
    rows.push(['Version 3 (shadow)', `${sh.v3.label} · own estimate ${ev(sh.v3.ev)} · ${sh.v3.computeMs.toFixed(0)} ms${sh.v3.used !== 'v3' ? ` · fell back to ${sh.v3.used}: ${sh.v3.fallback ?? ''}` : ''}`]);
    rows.push(['Same action', sh.sameAction ? (sh.sizeDiffers ? 'yes, different size' : 'yes') : 'no']);
  }
  rows.push(['Note', 'Each EV is that engine\'s own estimate under its own opponent model: they are not comparable. Neither shadow line is executed.']);
  return rows;
}

/** The last `n` actions of the hand, oldest first, with street headings. */
export function recentTimeline(l: LiveState, n = 12): { street: string | null; text: string; deduced: boolean; uncertain: boolean }[] {
  const out: { street: string | null; text: string; deduced: boolean; uncertain: boolean }[] = [];
  const items = l.timeline.slice(-n);
  let street = '';
  for (const e of items) {
    const who = l.participation.find((p) => p.seat === e.seat);
    const head = e.street !== street ? e.street : null;
    street = e.street;
    out.push({ street: head, text: `${e.text}${who ? ` · ${who.isHero ? 'you' : who.name}` : ''}`, deduced: e.inferred, uncertain: e.uncertain });
  }
  return out;
}
