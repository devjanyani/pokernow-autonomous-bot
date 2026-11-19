// Settings tab, in four groups: everyday preferences, strategy experiments, diagnostics and data, advanced controls.
import { parseLogCsv, replayLog } from '../../adapter/pokernow/log';
import { applyHandToProfiles, PlayerProfile } from '../../opponents/profile';
import { LiveState, Settings, toHandRecord } from '../records';
import { scheduleRows } from '../view';
import { button, confirmDialog, dl, download, el, select, stamp, toast } from '../ui/dom';
import type { Ctx } from '../ui/context';

type NumKey = 'exploitWeight' | 'assumedClockMs' | 'minConfidence';
type SecKey = 'minDelayMs' | 'maxDelayMs' | 'deadlineMarginMs' | 'assumedClockMs';

/** The live part of the timing section: refreshed on every live update without touching the form. */
export function renderScheduleStatus(l: LiveState | null): void {
  const box = typeof document !== 'undefined' ? document.getElementById('set-schedule-status') : null;
  if (!box) return;
  box.textContent = '';
  const rows = l && Date.now() - l.ts <= 60000 ? scheduleRows(l) : [];
  if (!rows.length) { box.append(el('p', { class: 'muted small' }, 'No table is reporting. Open an authorised table to see the pending action here.')); return; }
  const strat = l?.strategy ? `${l.strategy.selected}${l.strategy.experimental ? ' (experimental)' : l.strategy.selected === 'v2' ? ' (default)' : ''}` : '–';
  box.append(dl([['Strategy', strat], ...rows]));
}

export function renderSettings(root: HTMLElement, ctx: Ctx): void {
  const settings = ctx.settings();
  const rerender = () => renderSettings(root, ctx);
  root.textContent = '';
  const field = (label: string, help: string, control: HTMLElement) => el('div', { class: 'field' }, el('div', { class: 'fieldtext' }, el('label', { for: control.id }, label), help ? el('div', { class: 'muted small' }, help) : null), el('div', { class: 'fieldcontrol' }, control));
  const num = (key: NumKey, step: string, label: string, help: string) => {
    const i = el('input', { type: 'number', step, value: String(settings[key]), id: `set-${key}` });
    i.addEventListener('change', () => void ctx.saveSettings({ [key]: Number(i.value) }).then(() => { i.value = String(ctx.settings()[key]); toast('Saved.'); }));
    return field(label, help, i);
  };
  const secs = (key: SecKey, label: string, help: string) => {
    const i = el('input', { type: 'number', step: '0.5', min: '0', value: String(settings[key] / 1000), id: `set-${key}` });
    i.addEventListener('change', () => void ctx.saveSettings({ [key]: Math.round(Number(i.value) * 1000) }).then(() => { i.value = String(ctx.settings()[key] / 1000); toast('Saved.'); rerender(); }));
    return field(label, help, i);
  };
  const toggle = (key: 'showPanel' | 'recordDiagnostics' | 'shadowV3' | 'randomDelay', label: string, help: string) => {
    const c = el('input', { type: 'checkbox', id: `set-${key}`, class: 'switch' });
    c.checked = settings[key];
    c.addEventListener('change', () => void ctx.saveSettings({ [key]: c.checked }));
    return field(label, help, c);
  };
  const group = (id: string, title: string, intro: string, ...children: (Node | null)[]) => el('section', { class: 'card setgroup', id }, el('h2', {}, title), intro ? el('p', { class: 'muted' }, intro) : null, ...children);

  // ---- preferences ----
  const prefs = group('set-preferences', 'Preferences', 'Everyday options. Mode, authorisation and the emergency stop are in the toolbar popup.',
    field('Mode', 'Set in the toolbar popup.', el('span', { id: 'set-mode', class: 'strong' }, settings.estop ? 'Emergency stop on' : settings.mode === 'autonomous' ? 'Autonomous' : settings.mode === 'recommend' ? 'Recommend only' : 'Manual (observe only)')),
    toggle('showPanel', 'Show the in-page panel', 'The small movable panel on the PokerNow table.'));

  // ---- authorised autonomous play: timing ----
  const conflict = settings.assumedClockMs - settings.deadlineMarginMs < settings.maxDelayMs
    ? el('p', { class: 'small warn', id: 'set-timing-conflict' }, `When the page shows no clock, the assumed ${settings.assumedClockMs / 1000} s clock minus the ${settings.deadlineMarginMs / 1000} s margin leaves ${Math.max(0, settings.assumedClockMs - settings.deadlineMarginMs) / 1000} s, so delays are capped there${settings.assumedClockMs - settings.deadlineMarginMs < settings.minDelayMs ? ' and the minimum cannot be met' : ''}. A clock shown by the page takes precedence.`)
    : null;
  const timing = group('set-timing', 'Authorised autonomous play: timing', 'Applies only where clicking is permitted (autonomous mode, organiser authorisation confirmed, this table authorised). One delay is drawn per decision when your turn is confirmed, before the recommendation exists, so folds, checks, calls, bets and raises are timed the same way. Computation counts toward the delay. The deadline always wins: the action is due no later than the safety margin before it; when that leaves less than the minimum the minimum is not met and the dashboard says so. A plain uniform range, not a model of human timing.',
    toggle('randomDelay', 'Randomised delay', 'On: uniform between the minimum and the maximum, drawn per decision. Off: always the minimum.'),
    secs('minDelayMs', 'Minimum target delay (s)', 'Default 4.'),
    secs('maxDelayMs', 'Maximum target delay (s)', 'Default 20. Raised to the minimum if lower.'),
    secs('deadlineMarginMs', 'Deadline safety margin (s)', 'Act at least this long before the deadline. 0.5 to 10, default 3.'),
    secs('assumedClockMs', 'Clock to assume when none is shown (s)', 'Counted from the start of your turn; never unlimited. 3 to 120, default 20.'),
    conflict,
    el('div', { class: 'fieldblock' }, el('div', { class: 'strong' }, 'Now'), el('div', { id: 'set-schedule-status' })));

  // ---- strategy experiments ----
  const engine = select<Settings['strategyEngine']>(settings.strategyEngine, [
    ['v2', 'Version 2: two-street look-ahead (default)'],
    ['v1', 'Version 1: the 0.5.1 engine'],
    ['v3', 'v3 — Experimental (recommendation-only by default)'],
  ], (v) => {
    void ctx.saveSettings({ strategyEngine: v }).then(() => {
      toast(v === 'v3' ? `Strategy engine: v3 (experimental). ${ctx.settings().v3ExecutionOptIn ? 'Its execution permission is on: it acts on authorised tables.' : 'Recommendation-only: nothing will be clicked unless its separate execution permission is switched on.'} Takes effect at the next decision.` : `Strategy engine: ${v}. Takes effect at the next decision.`);
      rerender();
    });
  }, 'Strategy engine');
  engine.id = 'set-strategyEngine';
  const v3Note = settings.strategyEngine === 'v3'
    ? el('p', { class: 'small', id: 'set-v3-note' }, `Version 3 is experimental. ${settings.v3ExecutionOptIn ? 'Its execution permission is ON: on tables authorised for autonomous play it acts.' : 'It is recommendation-only: automatic play is disabled while it is selected, whatever the mode and table authorisation, unless the separate permission below is switched on.'} It searches heads-up pots after the flop (check-raises, re-raises, calling now and betting later); preflop and multiway spots fall back to version 2, and the dashboard says so for each recommendation. It has not been shown to play better than version 2 (reports/PHASE_2_5_STRATEGY_BENCHMARK.md).`)
    : null;
  const optIn = el('input', { type: 'checkbox', id: 'set-v3ExecutionOptIn', class: 'switch' });
  optIn.checked = settings.v3ExecutionOptIn;
  optIn.disabled = !settings.authorizationConfirmed && !settings.v3ExecutionOptIn;
  optIn.addEventListener('change', async () => {
    if (!optIn.checked) { await ctx.saveSettings({ v3ExecutionOptIn: false }); toast('Version 3 execution permission off: version 3 only recommends.'); rerender(); return; }
    const ok = await confirmDialog({
      title: 'Let experimental version 3 act?', confirmLabel: 'Allow version 3 to act',
      lines: [
        'Only for play-money games whose organiser allows bots. Version 3 has not been shown to play better than version 2.',
        'It acts only where clicking is already permitted: autonomous mode, the organiser-authorisation confirmation, and each table authorised in the popup. The emergency stop, state checks and legality checks still apply.',
        'Preflop and multiway spots are decided and executed by version 2, labelled as a fallback.',
      ],
      keeps: ['Withdrawing the authorisation confirmation in the popup also switches this off.'],
    });
    if (!ok) { optIn.checked = false; return; }
    await ctx.saveSettings({ v3ExecutionOptIn: true });
    toast('Version 3 execution permission on (experimental).');
    rerender();
  });
  const v3Exec = settings.strategyEngine === 'v3' || settings.v3ExecutionOptIn
    ? field('Allow version 3 to act on authorised tables (experimental)', settings.authorizationConfirmed ? 'Off by default. Separate from choosing version 3 and from authorising a table: all are needed.' : 'Needs the organiser-authorisation confirmation in the toolbar popup first.', optIn)
    : null;
  const strat = group('set-strategy', 'Strategy experiments', 'These change what is recommended. No engine has been shown to be better against real opponents: in simulation version 2 was never ahead of version 1 and was behind at some tables (docs/bot/STRATEGY_V2_DIAGNOSIS.md), and version 3 is level with version 2 (reports/PHASE_2_5_STRATEGY_BENCHMARK.md). All decisions stay local.',
    field('Strategy engine', 'Applies to recommendations and, where clicking is permitted, to automatic play. Version 3 acts only with its own permission below.', engine),
    v3Note,
    v3Exec,
    settings.strategyEngine === 'v2' ? toggle('shadowV3', 'Shadow comparison with version 3', 'Diagnostic, off by default. After version 2\'s recommendation is shown, also work out what version 3 would recommend and show both on the Live tab. Never executed; never delays version 2.') : null,
    num('exploitWeight', '0.1', 'Opponent-adjustment weight', '0 = ignore opponent statistics, 1 = use them fully.'));

  // ---- diagnostics and data ----
  const file = el('input', { type: 'file', accept: '.csv,.txt', id: 'import-file' });
  const importMsg = el('p', { class: 'muted small', id: 'import-msg' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const text = await f.text();
    const lines = text.trimStart().startsWith('entry,at,order') ? parseLogCsv(text) : text.split(/\r?\n/);
    const res = replayLog(lines, `log-${f.name.replace(/\W+/g, '-')}`);
    const profiles = new Map<string, PlayerProfile>();
    for (const p of await ctx.storage.allProfiles()) profiles.set(p.playerId, p);
    let stored = 0;
    for (const h of res.hands) {
      if (!h.valid) continue;
      const ids = applyHandToProfiles(profiles, h.hand, h.reveals, Date.now());
      if (await ctx.storage.saveHand(toHandRecord(h, 'imported-log', Date.now()), ids.map((i) => profiles.get(i)!))) stored++;
    }
    importMsg.textContent = `${res.hands.length} Hold'em hands read, ${res.hands.filter((h) => h.valid).length} replayed cleanly, ${stored} newly stored, ${res.unsupportedHands} other-variant hands skipped, ${res.unknownLines.length} unrecognised lines.`;
  });
  const data = group('set-diagnostics', 'Diagnostics and data', 'Everything is stored in this browser profile only. Nothing is uploaded.',
    toggle('recordDiagnostics', 'Record while a table is open', 'Keeps a bounded local recording for the debug bundle (Diagnostics tab).'),
    field('Import a PokerNow log', 'A CSV log downloaded from PokerNow, added to profiles and hand review.', file), importMsg,
    el('div', { class: 'rowactions' },
      button('Export all local data (JSON)', async () => { download(`poker-bot-data-${stamp()}.json`, JSON.stringify(await ctx.storage.exportAll())); }),
      button('Manage tables and history', () => ctx.goto('tables')),
      button('Recordings and log', () => ctx.goto('diag'))));

  // ---- advanced ----
  const timeout = select<Settings['timeoutAction']>(settings.timeoutAction, [['check-fold', 'Check, or fold if a check is not possible'], ['nothing', 'Do nothing (let the site time the seat out)']], (v) => void ctx.saveSettings({ timeoutAction: v }), 'Timeout action');
  timeout.id = 'set-timeout';
  const sel = el('textarea', { id: 'set-selectors', spellcheck: 'false', class: 'mono' });
  sel.value = JSON.stringify(settings.selectorOverrides, null, 2);
  const selMsg = el('span', { class: 'muted small' });
  const selBtn = button('Save selector overrides', () => {
    try { void ctx.saveSettings({ selectorOverrides: JSON.parse(sel.value || '{}') }).then(() => { sel.value = JSON.stringify(ctx.settings().selectorOverrides, null, 2); selMsg.textContent = ' Saved.'; }); }
    catch { selMsg.textContent = ' Not valid JSON.'; }
  });
  const wipe = button('Delete all local data', async () => {
    const ok = await confirmDialog({
      title: 'Delete all local data?', danger: true, confirmLabel: 'Delete everything', typeToConfirm: 'delete',
      lines: ['Every stored opponent profile, hand, recommendation, recording, log line and table nickname is permanently deleted.'],
      keeps: ['Settings and table authorisations (revoke those on the Tables tab).'],
    });
    if (!ok) return;
    const ids = (await ctx.storage.allProfiles()).map((p) => p.playerId);
    await ctx.storage.clear(['profiles', 'hands', 'decisions', 'diagnostics', 'frames', 'meta', 'tables', 'sessions']);
    await ctx.profilesDeleted(ids);
    toast('All local data deleted.');
    rerender();
  }, { tone: 'danger', id: 'set-wipe' });
  const adv = group('set-advanced', 'Advanced', 'Change these only when you know why.',
    num('minConfidence', '0.05', 'Minimum state score to act', '0.4 to 1. A heuristic score: 0.15 is lost per open warning.'),
    num('assumedClockMs', '1000', 'Action clock to assume (ms)', 'Used when the page shows no clock.'),
    field('When the clock is nearly out and the state is not trusted', 'Autonomous mode only.', timeout),
    el('div', { class: 'fieldblock' }, el('label', { for: 'set-selectors' }, 'PokerNow selector overrides'), el('div', { class: 'muted small' }, 'JSON object, e.g. {"foldBtn": "button.fold"}. Keys are the names in src/bot/adapter/pokernow/dom.ts.'), sel, el('div', { class: 'rowactions' }, selBtn, selMsg)),
    el('div', { class: 'dangerzone' }, el('div', {}, el('div', { class: 'strong' }, 'Delete all local data'), el('div', { class: 'muted small' }, 'To remove individual tables, hands, recordings or profiles use their own tabs.')), wipe));

  root.append(el('div', { class: 'setgrid' }, prefs, timing, strat, data, adv), el('p', { class: 'muted small' }, `Poker bot ${ctx.version}. Database version 3.`));
  renderScheduleStatus(ctx.live());
}
