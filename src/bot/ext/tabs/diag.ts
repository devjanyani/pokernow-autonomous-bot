// ============================================================
// Diagnostics tab.
//   1. Live checks for the table that is open (collapsible sections).
//   2. What is stored, by table.
//   3. Recording sessions (one per visit to a table): export or delete.
//   4. The log: searchable, filterable, deletable line by line.
//   5. Debug bundle export.
// ============================================================

import { buildBundle } from '../../diag/recorder';
import type { Indicator, LiveState } from '../records';
import { button, check, checkAll, confirmDialog, dl, download, el, empty, pager, searchBox, select, stamp, tag, toast } from '../ui/dom';
import type { Ctx } from '../ui/context';
import { ago, hasHistory, matches, paginate, sessionEntries, tableEntries, tableLabel } from '../viewmodel';

const state = {
  logQuery: '', logLevel: 'all' as 'all' | 'error' | 'warn' | 'info', logTable: 'all', logPage: 1, logSelected: new Set<string>(),
  sessionQuery: '', sessionSelected: new Set<string>(),
  bundleScope: '5', bundleAnon: false, preview: null as string | null,
};
const sectionOpen = new Map<string, boolean>();
/** Collapsible section; whether it is open survives re-rendering. */
function section(key: string, title: string, openByDefault: boolean, ...children: (Node | string | null)[]): HTMLElement {
  const d = el('details', { class: 'card sec', 'data-key': key }, el('summary', {}, title), ...children);
  d.open = sectionOpen.get(key) ?? openByDefault;
  d.addEventListener('toggle', () => sectionOpen.set(key, d.open));
  return d;
}
const LEVEL_CLASS: Record<string, string> = { ok: 'good', warn: 'warn', bad: 'bad', na: 'muted' };
const LEVEL_WORD: Record<string, string> = { ok: 'OK', warn: 'CHECK', bad: 'PROBLEM', na: '–' };
const indicator = (i: Indicator) => el('span', {}, el('span', { class: `strong ${LEVEL_CLASS[i.level]}` }, LEVEL_WORD[i.level]), i.detail ? ` · ${i.detail}` : '');

function liveSections(l: LiveState): HTMLElement[] {
  const out: HTMLElement[] = [];
  const r = l.readiness;
  const who = (seat: number | null) => { const p = l.participation.find((x) => x.seat === seat); return seat === null ? 'nobody' : p ? `seat ${seat} · ${p.position ?? '–'} · ${p.name}` : `seat ${seat}`; };
  const last = l.timeline[l.timeline.length - 1];
  out.push(section('checks', 'State checks', true, dl([
    ['Observation health', indicator(r.observation)], ['Game-state consistency', indicator(r.consistency)], ['Turn', indicator(r.turn)],
    ['Legal actions', indicator(r.legal)], ['Decision readiness', indicator(r.decision)], ['Strategy uncertainty', indicator(r.strategy)],
  ]), el('p', { class: 'muted small' }, `Heuristic score used by the click guard: ${l.tracker.confidence.toFixed(2)} (1 minus 0.15 per open warning, 0.3 when blocked; not a probability).`)));
  out.push(section('turn', 'Turn tracking', true, dl([
    ['Observed actor (table)', who(l.tracker.observedActor)],
    ['Predicted actor (engine)', who(l.tracker.predictedActor)],
    ['Actor verified', l.tracker.turnStatus === 'agree' ? el('span', { class: 'good' }, 'yes: both agree') : l.tracker.turnStatus === 'disagree' ? el('span', { class: 'bad' }, 'NO: they disagree') : l.tracker.turnStatus === 'unobserved' ? el('span', { class: 'warn' }, 'not verified: the table shows no acting seat') : '–'],
    ['Last confirmed action', last ? `${last.text} (${last.name})${last.inferred ? ' [deduced]' : ''}` : '–'],
    ['Hero', l.tracker.heroStatus],
    ['Table settled', l.tracker.settled ? 'yes' : 'still changing'],
  ]), l.tracker.blockers.length ? el('ul', { class: 'bad' }, ...l.tracker.blockers.map((b) => el('li', {}, b))) : null));
  const lc = l.tracker.legal.context;
  out.push(section('buttons', 'Action buttons (as read, by label)', l.tracker.legal.status === 'mismatch', lc ? dl([
    ['Buttons', el('span', {}, ...lc.controls.map((c) => el('div', {}, c)))],
    ['Wager button label', lc.wagerLabel ?? '–'],
    ['Size shortcuts', lc.presets.length ? lc.presets.join(', ') : '–'],
    ['Reconstructed amount to call', String(lc.toCall)],
    ['Street', lc.street],
    ['Hero in front this street', String(lc.heroStreetCommit)],
    ['Highest bet this street', String(lc.currentBet)],
    ['Comparison', `${l.tracker.legal.status}${l.tracker.legal.detail ? `: ${l.tracker.legal.detail}` : ''}`],
  ]) : el('p', { class: 'muted' }, 'Shown on your turn.'), el('p', { class: 'muted small' }, 'A button is classified by its text. "Bet 5" is a bet you may make; only a button that says "Call" is an amount to call.')));
  const tl = el('div', { class: 'tlfull' });
  let street = '';
  for (const e of l.timeline) {
    if (e.street !== street) { street = e.street; tl.append(el('h2', {}, street.charAt(0).toUpperCase() + street.slice(1))); }
    tl.append(el('div', { class: e.uncertain ? 'bad' : e.inferred ? 'warn' : '' }, `${e.text} · ${e.name}${e.uncertain ? ' · deduced, UNCONFIRMED' : e.inferred ? ' · deduced' : ''}`, e.note ? el('span', { class: 'muted' }, ` (${e.note})`) : null));
  }
  if (l.hand && l.hand.phase !== 'complete') tl.append(el('div', { class: 'muted' }, `Next: ${who(l.tracker.predictedActor)}${l.tracker.turnStatus === 'agree' ? ' (verified)' : l.tracker.turnStatus === 'disagree' ? ` (table shows ${who(l.tracker.observedActor)})` : ' (not verified)'}`));
  out.push(section('timeline', 'Action timeline (current hand)', true, l.timeline.length ? tl : el('p', { class: 'muted' }, 'No hand is being tracked.'), el('p', { class: 'muted small' }, 'Entries marked "deduced" were not displayed by the table: they follow from the rules (see the note). Nothing else is added.')));
  const pt = el('table', { class: 'compact' }, el('thead', {}, el('tr', {}, el('th', {}, 'Seat'), el('th', {}, 'Player'), el('th', {}, 'Pos'), el('th', {}, 'In this hand'), el('th', {}, 'Betting'), el('th', {}, 'Presence'), el('th', { class: 'num' }, 'Stack'), el('th', { class: 'num' }, 'Street'), el('th', { class: 'num' }, 'Hand'))));
  const pb = el('tbody');
  for (const p of l.participation) pb.append(el('tr', {}, el('td', {}, String(p.seat)), el('td', {}, p.name + (p.isHero ? ' (hero)' : '')), el('td', {}, p.position ?? ''),
    el('td', {}, p.dealtIn ? (p.folded ? 'folded' : 'contesting') : p.sittingOut ? 'sitting out' : 'waiting for next hand'),
    el('td', {}, !p.dealtIn ? '–' : p.folded ? '–' : p.allIn ? 'all-in' : p.canAct ? 'can act' : '–'),
    el('td', { class: p.left || p.disconnected ? 'warn' : '' }, p.left ? 'no longer visible' : p.disconnected ? 'disconnected' : 'present'),
    el('td', { class: 'num' }, p.stack === null ? '?' : String(p.stack)), el('td', { class: 'num' }, p.streetCommit ? String(p.streetCommit) : ''), el('td', { class: 'num' }, p.totalCommit ? String(p.totalCommit) : '')));
  pt.append(pb);
  out.push(section('participation', 'Player participation (per-seat state)', false, el('div', { class: 'tablewrap' }, pt)));
  out.push(section('system', 'System', false, dl([
    ['Mode', l.estop ? 'EMERGENCY STOP' : l.acting ? 'autonomous (acting)' : l.mode],
    ['Engine status', l.status],
    ['Phase', l.tracker.phase],
    ['Hand id', l.hand?.handId ?? '–'],
    ['Decision deadline', l.deadlineMs !== null ? `${(l.deadlineMs / 1000).toFixed(1)}s${l.observation.timeRemainingMs === null ? ' (assumed clock)' : ''}` : '–'],
    ['Last execution', l.lastExecution ? `${l.lastExecution.status}: ${l.lastExecution.action} (${l.lastExecution.reason})` : '–'],
    ['Hands tracked', String(l.tracker.handsSeen)],
    ['Recommendation state', `${l.recommendation.state}${l.recommendation.context ? ` · ${l.recommendation.context.key}` : ''}`],
  ])));
  // Strategy: which engine is selected, which one decided the shown recommendation and why, and the fitted tables.
  const s = l.strategy, note = l.decision?.strategy;
  if (s) {
    out.push(section('strategy', 'Strategy engine and opponent model', s.selected === 'v3', dl([
      ['Selected', `${s.selected}${s.experimental ? (s.v3Execution ? ' (experimental, execution permission on)' : ' (experimental, recommendation-only)') : s.selected === 'v2' ? ' (default)' : ''}`],
      ['Shown recommendation decided by', note ? `${note.used}${note.fallback ? ` (fallback: ${note.fallback})` : ''}` : '–'],
      ['Opponent-response model', note?.opponentModel ?? (note ? (note.used === 'v3' ? '–' : `${note.used}'s range-aware behaviour model (heuristic)`) : '–')],
      ['Fitted tables used', note?.calibration ? `population calibration ${note.calibration.population}; river range tilt ${note.calibration.river}${note.calibration.notes.length ? ` (${note.calibration.notes.join('; ')})` : ''}` : '–'],
      ['Shadow comparison', s.shadowV3 ? 'on (diagnostic only)' : 'off'],
      ...s.artifacts.map((a): [string, string] => [`Table: ${a.name}`, `${a.state}${a.reason ? ` (${a.reason})` : ''}${a.source ? ` · source ${a.source}` : ''}${a.fittedOn ? ` · fitted on ${a.fittedOn}` : ''}${a.cells ? ` · ${a.cells} cells` : ''}`]),
    ]), el('p', { class: 'muted small' }, 'The fitted tables are small aggregate files packaged with the extension (no hand or player data). A table that fails its checks is not used, and version 3 falls back to its hand-set baseline.')));
  }
  out.push(section('issues', `Tracker messages this hand (${l.tracker.issues.length})`, l.tracker.issues.length > 0, l.tracker.issues.length ? el('ul', { class: 'warn' }, ...l.tracker.issues.map((i) => el('li', {}, i))) : el('p', { class: 'muted' }, 'None.')));
  if (l.tracker.discrepancies.length) out.push(section('discrepancies', `Discrepancies this hand (${l.tracker.discrepancies.length})`, true, el('ul', {}, ...l.tracker.discrepancies.map((x) => el('li', { class: x.blocking ? 'bad' : 'warn' }, `[${x.kind}] ${x.street}, after ${x.eventCount} events: ${x.message}`)))));
  const health = Object.entries(l.observation.health);
  out.push(section('elements', 'Page elements (last read)', false, health.length ? el('div', {}, ...health.map(([k, ok]) => el('span', { class: `pill ${ok ? 'good' : 'bad'}` }, `${k}: ${ok ? 'found' : 'MISSING'}`))) : el('p', { class: 'muted' }, 'No read yet.'),
    el('p', { class: 'muted small' }, 'A missing element usually means PokerNow changed its markup. Selectors can be overridden in Settings without rebuilding.'),
    l.observation.problems.length ? el('ul', { class: 'warn' }, ...l.observation.problems.map((p) => el('li', {}, p))) : null));
  return out;
}

/** True while the user is working in a control of this tab that a live redraw would disturb. */
export function diagBusy(): boolean {
  const a = document.activeElement;
  return state.preview !== null || !!document.querySelector('dialog[open]') || (!!a && a.closest('#tab-diag') !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

let token = 0;
export async function renderDiag(root: HTMLElement, ctx: Ctx): Promise<void> {
  const mine = ++token;
  const [log, sessions, summaries] = [await ctx.storage.diagnosticsWithKeys(), await ctx.storage.sessionSummaries(), await ctx.loadTables()];
  if (mine !== token) return;
  const rerender = () => { void renderDiag(root, ctx); };
  const focusId = document.activeElement?.id ?? '';
  const nick = ctx.nicknames();
  const now = Date.now();
  const live = ctx.live();
  const fresh = live && now - live.ts < 20000 ? live : null;
  const settings = ctx.settings();
  root.textContent = '';

  // ---- 1. live ----
  const liveWrap = el('div', { class: 'stack', id: 'diag-live' });
  if (fresh) {
    const problems = Object.values(fresh.readiness).filter((i) => i.level === 'bad').length;
    liveWrap.append(el('div', { class: 'statusline' },
      el('span', { class: `statuspill ${problems ? 'bad' : fresh.tracker.warnings.length ? 'warn' : 'good'}` }, problems ? `${problems} check(s) failing` : fresh.tracker.warnings.length ? `${fresh.tracker.warnings.length} warning(s)` : 'All checks pass'),
      el('span', { class: 'muted' }, `${tableLabel(fresh.tableId, nick)} · ${fresh.status}`)), ...liveSections(fresh));
  } else liveWrap.append(el('div', { class: 'card' }, empty('No table is open', 'The live checks appear here while a PokerNow table is open in another tab. Stored recordings and the log are below.')));
  root.append(el('h3', { class: 'grouptitle' }, 'Live table'), liveWrap);

  // ---- 2. storage by table ----
  const tables = tableEntries(summaries, settings, ctx.activeTableId(), now).filter(hasHistory);
  const tt = el('table', { class: 'data' }, el('thead', {}, el('tr', {}, el('th', {}, 'Table'), el('th', {}, 'Last seen'), el('th', { class: 'num' }, 'Hands'), el('th', { class: 'num' }, 'Recommendations'), el('th', { class: 'num' }, 'Frames'), el('th', { class: 'num' }, 'Log lines'))));
  const tb = el('tbody');
  for (const t of tables) tb.append(el('tr', {}, el('td', {}, el('span', { class: 'strong' }, t.label), t.active ? tag('open now', 'accent') : null), el('td', { class: 'muted' }, ago(t.lastSeen, now)), el('td', { class: 'num' }, String(t.hands)), el('td', { class: 'num' }, String(t.decisions)), el('td', { class: 'num' }, String(t.frames)), el('td', { class: 'num' }, String(t.diagnostics))));
  tt.append(tb);
  const unassigned = log.filter((r) => !r.tableId).length;
  root.append(el('h3', { class: 'grouptitle' }, 'Stored data by table'),
    el('div', { class: 'card flush' }, tables.length ? el('div', { class: 'tablewrap' }, tt) : empty('Nothing stored', 'Recording starts when a table is opened.'),
      el('div', { class: 'cardfoot' }, el('span', { class: 'muted small' }, `${unassigned} log line(s) are not tied to a table (written before this version, or by the dashboard).`), el('span', { class: 'spacer' }), button('Manage tables', () => ctx.goto('tables'), { tone: 'quiet' }))));

  // ---- 3. recording sessions ----
  const sess = sessionEntries(sessions, nick).filter((s) => matches(state.sessionQuery, s.table, s.tableId, new Date(s.firstWall).toLocaleString()));
  for (const id of [...state.sessionSelected]) if (!sessions.some((s) => s.session === id)) state.sessionSelected.delete(id);
  const st = el('table', { class: 'data', id: 'sessions-table' }, el('thead', {}, el('tr', {}, el('th', { class: 'chk' }, checkAll(state.sessionSelected, sess.map((s) => s.session), rerender)), el('th', {}, 'Table'), el('th', {}, 'Started'), el('th', { class: 'num' }, 'Length'), el('th', { class: 'num' }, 'Hands'), el('th', { class: 'num' }, 'Frames'), el('th', {}, ''))));
  const sb = el('tbody');
  for (const s of sess) {
    sb.append(el('tr', { 'data-id': s.session },
      el('td', { class: 'chk' }, check(state.sessionSelected, s.session, rerender, `Select the session of ${new Date(s.firstWall).toLocaleString()}`)),
      el('td', {}, el('span', { class: 'strong' }, s.table), fresh && fresh.tableId === s.tableId && now - s.lastWall < 30000 ? tag('recording', 'accent') : null),
      el('td', { class: 'nowrap' }, new Date(s.firstWall).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
      el('td', { class: 'num' }, `${s.minutes} min`), el('td', { class: 'num' }, String(s.hands)), el('td', { class: 'num' }, String(s.frames)),
      el('td', { class: 'nowrap' }, button('Export', async () => {
        const frames = await ctx.storage.framesForSessions([s.session]);
        const b = buildBundle(frames, { hands: 'all', anonymise: state.bundleAnon, extensionVersion: ctx.version, userAgent: navigator.userAgent, framesPruned: await ctx.storage.framesPruned(), handRecords: await ctx.storage.recentHands(5000), decisions: await ctx.storage.recentDecisions(20000), diagnostics: log.filter((r) => r.tableId === s.tableId) });
        download(`poker-bot-debug-${stamp()}.json`, JSON.stringify(b));
      }, { tone: 'quiet', title: 'Debug bundle of this session only' }))));
  }
  st.append(sb);
  root.append(el('h3', { class: 'grouptitle' }, 'Recording sessions'),
    el('div', { class: 'toolbar' }, searchBox(state.sessionQuery, 'Search sessions by table or date', (v) => { state.sessionQuery = v; rerender(); }, 'session-search'), el('span', { class: 'spacer' }),
      button(`Delete selected (${state.sessionSelected.size})`, async () => {
        const ids = [...state.sessionSelected];
        const n = sessions.filter((s) => ids.includes(s.session)).reduce((a, s) => a + s.frames, 0);
        const ok = await confirmDialog({ title: `Delete ${ids.length} recording session(s)?`, danger: true, confirmLabel: 'Delete recordings', lines: [`${n} recorded frame(s) are permanently deleted. These hands can no longer be exported in a debug bundle or replayed.`], keeps: ['Hand summaries, recommendations and opponent profiles.'] });
        if (!ok) return;
        const rep = await ctx.storage.deleteSessions(ids);
        state.sessionSelected.clear();
        toast(`${rep.frames} frame(s) deleted.`);
        rerender();
      }, { tone: 'danger', disabled: state.sessionSelected.size === 0, id: 'sessions-delete' })),
    el('div', { class: 'card flush' }, sess.length ? el('div', { class: 'tablewrap' }, st) : empty(sessions.length ? 'No session matches' : 'No recordings stored', sessions.length ? 'Change the search.' : 'A session is recorded each time a table is open with recording on.'),
      el('div', { class: 'cardfoot muted small' }, 'A session is one visit to a table. A recording holds what the table showed, frame by frame; deleting it keeps the hand summaries. To delete the recording of a single hand, open the hand in Hand review.')));

  // ---- 4. log ----
  const logTables = [...new Set(log.map((r) => r.tableId).filter((t): t is string => !!t))];
  const rows = log.filter((r) => (state.logLevel === 'all' || r.level === state.logLevel) && (state.logTable === 'all' || (state.logTable === 'none' ? !r.tableId : r.tableId === state.logTable)) && matches(state.logQuery, r.message, r.source, r.data ? JSON.stringify(r.data) : ''));
  const page = paginate(rows, state.logPage, 50);
  state.logPage = page.page;
  for (const k of [...state.logSelected]) if (!log.some((r) => String(r.key) === k)) state.logSelected.delete(k);
  const lt = el('table', { class: 'data log', id: 'log-table' }, el('thead', {}, el('tr', {}, el('th', { class: 'chk' }, checkAll(state.logSelected, page.rows.map((r) => String(r.key)), rerender)), el('th', {}, 'Time'), el('th', {}, 'Level'), el('th', {}, 'Table'), el('th', {}, 'Message'))));
  const lb = el('tbody');
  for (const r of page.rows) {
    const data = r.data ? JSON.stringify(r.data) : '';
    lb.append(el('tr', { 'data-key': String(r.key) }, el('td', { class: 'chk' }, check(state.logSelected, String(r.key), rerender, 'Select this log line')),
      el('td', { class: 'nowrap muted' }, new Date(r.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })),
      el('td', {}, tag(r.level, r.level === 'error' ? 'bad' : r.level === 'warn' ? 'warn' : 'muted')),
      el('td', { class: 'nowrap' }, r.tableId ? tableLabel(r.tableId, nick) : el('span', { class: 'muted' }, '–')),
      el('td', { class: 'logmsg' }, r.message, data ? el('details', { class: 'more' }, el('summary', {}, 'Data'), el('pre', {}, data.length > 4000 ? `${data.slice(0, 4000)}…` : data)) : null)));
  }
  lt.append(lb);
  root.append(el('h3', { class: 'grouptitle' }, 'Log'),
    el('div', { class: 'toolbar' }, searchBox(state.logQuery, 'Search the log', (v) => { state.logQuery = v; state.logPage = 1; rerender(); }, 'log-search'),
      select(state.logLevel, [['all', 'All levels'], ['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Information']], (v) => { state.logLevel = v; state.logPage = 1; rerender(); }, 'Level'),
      select(state.logTable, [['all', 'All tables'], ...logTables.map((t) => [t, tableLabel(t, nick)] as [string, string]), ['none', 'Not tied to a table']], (v) => { state.logTable = v; state.logPage = 1; rerender(); }, 'Table'),
      el('span', { class: 'spacer' }), el('span', { class: 'muted' }, `${rows.length} of ${log.length} lines`),
      button(`Delete selected (${state.logSelected.size})`, async () => {
        const rep = await ctx.storage.deleteDiagnostics([...state.logSelected].map(Number));
        state.logSelected.clear();
        toast(`${rep.diagnostics} log line(s) deleted.`);
        rerender();
      }, { tone: 'danger', disabled: state.logSelected.size === 0, id: 'log-delete' }),
      button('Delete all log lines', async () => {
        const ok = await confirmDialog({ title: `Delete all ${log.length} log line(s)?`, danger: true, confirmLabel: 'Delete the log', lines: ['Every stored log line is permanently deleted.'], keeps: ['Hands, recordings, recommendations and profiles.'] });
        if (!ok) return;
        await ctx.storage.deleteDiagnostics('all');
        toast('Log deleted.');
        rerender();
      }, { tone: 'quiet', disabled: log.length === 0 })),
    el('div', { class: 'card flush' }, rows.length ? el('div', { class: 'tablewrap' }, lt) : empty(log.length ? 'No line matches' : 'The log is empty', log.length ? 'Change the search or the filters.' : 'Warnings and errors from the table tab are listed here.'), pager(page, (p) => { state.logPage = p; rerender(); }, 'lines')));

  // ---- 5. debug bundle ----
  const recOn = el('input', { type: 'checkbox', id: 'bundle-rec' });
  recOn.checked = settings.recordDiagnostics;
  recOn.addEventListener('change', () => void ctx.saveSettings({ recordDiagnostics: recOn.checked }));
  const anon = el('input', { type: 'checkbox', id: 'bundle-anon' });
  anon.checked = state.bundleAnon;
  anon.addEventListener('change', () => { state.bundleAnon = anon.checked; });
  const scope = select(state.bundleScope, [['1', 'Most recent hand'], ['5', 'Last 5 hands'], ['20', 'Last 20 hands'], ['all', 'Everything stored']], (v) => { state.bundleScope = v; }, 'What to export');
  scope.id = 'bundle-scope';
  const preview = el('textarea', { id: 'bundle-preview', spellcheck: 'false', class: 'mono', style: `height:220px;${state.preview === null ? 'display:none' : ''}` });
  if (state.preview !== null) preview.value = state.preview;
  preview.addEventListener('input', () => { state.preview = preview.value; });
  const bundleMsg = el('p', { class: 'muted small', id: 'bundle-msg' });
  const make = async () => {
    const frames = await ctx.storage.recentFrames();
    const b = buildBundle(frames, {
      hands: state.bundleScope === 'all' ? 'all' : Number(state.bundleScope), anonymise: state.bundleAnon, extensionVersion: ctx.version, userAgent: navigator.userAgent,
      settings: { mode: settings.mode, minConfidence: settings.minConfidence, selectorOverrides: settings.selectorOverrides, recordDiagnostics: settings.recordDiagnostics, strategyEngine: settings.strategyEngine, shadowV3: settings.shadowV3, v3Artifacts: ctx.live()?.strategy?.artifacts ?? [] },
      framesPruned: await ctx.storage.framesPruned(), framesDroppedBeforeStorage: ctx.live()?.recorder.dropped ?? 0,
      handRecords: await ctx.storage.recentHands(5000), decisions: await ctx.storage.recentDecisions(20000), diagnostics: await ctx.storage.recentDiagnostics(300),
    });
    bundleMsg.textContent = `${b.hands.length} hand(s), ${b.hands.reduce((a, x) => a + x.frames.length, 0)} frame(s). ${b.dropped.note}`;
    return b;
  };
  root.append(el('h3', { class: 'grouptitle' }, 'Debug bundle'), el('div', { class: 'card' },
    el('p', { class: 'muted' }, 'A local recording of what the table showed (seats, names, stacks, bets, board, your own cards, buttons) and what the reconstruction made of it, one frame per change. It is stored in this browser only and leaves it only when you export the file yourself. It contains no passwords, cookies or tokens, and no opponent cards other than those shown at showdown.'),
    el('label', { class: 'checkline' }, recOn, el('span', {}, `Record while a table is open${fresh ? ` (${fresh.recorder.recorded} frames this session, ${fresh.recorder.dropped} dropped)` : ''}`)),
    el('div', { class: 'formrow' }, el('label', { for: 'bundle-scope' }, 'What to export'), scope),
    el('label', { class: 'checkline' }, anon, el('span', {}, 'Replace player names and the table id with placeholders')),
    el('div', { class: 'rowactions' },
      button('Review before export', async () => { state.preview = JSON.stringify(await make(), null, 1); preview.value = state.preview; preview.style.display = 'block'; }),
      button('Export Debug Bundle', async () => {
        // If the reviewed text was edited by hand, export exactly that text.
        const text = state.preview !== null && preview.value ? preview.value : JSON.stringify(await make());
        try { JSON.parse(text); } catch { bundleMsg.textContent = 'The edited text is not valid JSON; nothing exported.'; return; }
        download(`poker-bot-debug-${stamp()}.json`, text);
      }, { tone: 'primary', id: 'bundle-export' }),
      state.preview !== null ? button('Close review', () => { state.preview = null; rerender(); }, { tone: 'quiet' }) : null),
    bundleMsg, preview));
  const f = focusId ? document.getElementById(focusId) : null;
  if (f instanceof HTMLInputElement && f.type === 'search') { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}
