// Settings tab, in four groups: everyday preferences, strategy experiments, diagnostics and data, advanced controls.
import { parseLogCsv, replayLog } from '../../adapter/pokernow/log';
import { applyHandToProfiles, PlayerProfile } from '../../opponents/profile';
import { Settings, toHandRecord } from '../records';
import { button, confirmDialog, download, el, select, stamp, toast } from '../ui/dom';
import type { Ctx } from '../ui/context';

type NumKey = 'exploitWeight' | 'minThinkMs' | 'maxThinkMs' | 'assumedClockMs' | 'minConfidence';

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
  const toggle = (key: 'showPanel' | 'recordDiagnostics', label: string, help: string) => {
    const c = el('input', { type: 'checkbox', id: `set-${key}`, class: 'switch' });
    c.checked = settings[key];
    c.addEventListener('change', () => void ctx.saveSettings({ [key]: c.checked }));
    return field(label, help, c);
  };
  const group = (id: string, title: string, intro: string, ...children: (Node | null)[]) => el('section', { class: 'card setgroup', id }, el('h2', {}, title), intro ? el('p', { class: 'muted' }, intro) : null, ...children);

  // ---- preferences ----
  const prefs = group('set-preferences', 'Preferences', 'Everyday options. Mode, authorisation and the emergency stop are in the toolbar popup.',
    field('Mode', 'Set in the toolbar popup.', el('span', { id: 'set-mode', class: 'strong' }, settings.estop ? 'Emergency stop on' : settings.mode === 'autonomous' ? 'Autonomous' : settings.mode === 'recommend' ? 'Recommend only' : 'Manual (observe only)')),
    toggle('showPanel', 'Show the in-page panel', 'The small movable panel on the PokerNow table.'),
    num('minThinkMs', '100', 'Think time before acting, minimum (ms)', 'Autonomous mode only.'),
    num('maxThinkMs', '100', 'Think time before acting, maximum (ms)', 'Never extends past the action clock.'));

  // ---- strategy experiments ----
  const engine = select(settings.strategyEngine, [['v2', 'Version 2: two-street look-ahead (default)'], ['v1', 'Version 1: the 0.5.1 engine']], (v) => { void ctx.saveSettings({ strategyEngine: v }).then(() => toast(`Strategy engine: ${v}. Takes effect at the next decision.`)); }, 'Strategy engine');
  engine.id = 'set-strategyEngine';
  const strat = group('set-strategy', 'Strategy experiments', 'These change what is recommended. Neither engine has been shown to be better against real opponents: in simulation version 2 was never ahead of version 1 and was behind at some tables (docs/bot/STRATEGY_V2_DIAGNOSIS.md). All decisions stay local either way.',
    field('Strategy engine', 'Applies to recommendations and, when authorised, to automatic play.', engine),
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

  root.append(el('div', { class: 'setgrid' }, prefs, strat, data, adv), el('p', { class: 'muted small' }, `Poker bot ${ctx.version}. Database version 3.`));
}
