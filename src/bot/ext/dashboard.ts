// ============================================================
// Dashboard (extension page): live monitor, opponent profiles, hand review,
// diagnostics, settings. Reads the extension's own IndexedDB directly and the
// live snapshot from chrome.storage.session. All text from the table (player
// names, log lines) is inserted with textContent, never as HTML.
// ============================================================

import { parseLogCsv, replayLog } from '../adapter/pokernow/log';
import {
  applyHandToProfiles, classify, exploitNotes, PlayerProfile, posterior, SIZE_BUCKETS, StatKey, styleLabel,
} from '../opponents/profile';
import { DecisionRecord, HandRecord, LiveState, sanitizeSettings, Settings, toHandRecord } from './records';
import { BotStorage } from './storage';

const storage = new BotStorage();
let settings: Settings;
let live: LiveState | null = null;
let activeTab = 'live';

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
const card = (title: string, ...children: Child[]) => el('div', { class: 'card' }, el('h2', {}, title), ...children);
const dl = (rows: [string, string | Node][]) => { const d = el('dl'); for (const [k, v] of rows) d.append(el('dt', {}, k), el('dd', {}, v)); return d; };
const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : `${(100 * x).toFixed(digits)}%`);
const $ = (id: string) => document.getElementById(id) as HTMLElement;

// ---- live ---------------------------------------------------------------------

function renderLive(): void {
  const root = $('tab-live');
  root.textContent = '';
  if (!live || Date.now() - live.ts > 20000) {
    root.append(card('No live table', el('p', { class: 'muted' }, 'Open a PokerNow table in another tab. The content script reports here a few times per second.')));
    return;
  }
  const l = live, h = l.hand, d = l.decision;
  const grid = el('div', { class: 'grid' });
  const conf = l.tracker.confidence;
  grid.append(card('System status', dl([
    ['Mode', l.estop ? 'EMERGENCY STOP' : l.acting ? 'autonomous (acting)' : l.mode],
    ['Engine', l.status],
    ['Observation', Object.entries(l.observation.health).filter(([, ok]) => !ok).map(([k]) => k).join(', ') ? `missing: ${Object.entries(l.observation.health).filter(([, ok]) => !ok).map(([k]) => k).join(', ')}` : 'all key elements found'],
    ['Hand state', l.tracker.unsupported ? 'unsupported game' : !h ? (l.tracker.waitingReason ?? 'waiting') : l.tracker.valid ? 'valid' : 'INVALID'],
    ['State confidence', el('span', { class: conf >= 0.7 ? 'good' : conf > 0 ? 'warn' : 'bad' }, conf.toFixed(2))],
    ['Decision deadline', l.deadlineMs !== null ? `${(l.deadlineMs / 1000).toFixed(1)}s${l.observation.timeRemainingMs === null ? ' (assumed clock)' : ''}` : '–'],
    ['Last execution', l.lastExecution ? `${l.lastExecution.status}: ${l.lastExecution.action} (${l.lastExecution.reason})` : '–'],
    ['Hands tracked', String(l.tracker.handsSeen)],
  ]), l.tracker.issues.length ? el('ul', { class: 'warn' }, ...l.tracker.issues.slice(-5).map((i) => el('li', {}, i))) : null));

  if (h) {
    grid.append(card('Game', dl([
      ['Hand', h.handId.split(':').slice(1, 3).join(' #')],
      ['Hero', `${h.heroCards?.join(' ') ?? 'not dealt in'}${h.heroPosition ? ` · ${h.heroPosition}` : ''}`],
      ['Board', h.board.join(' ') || '–'],
      ['Street', h.phase],
      ['Pot', `${h.pot} (${(h.pot / h.bigBlind).toFixed(1)} bb)`],
      ['Effective stack', h.effectiveStackBB !== null ? `${h.effectiveStackBB.toFixed(1)} bb` : '–'],
      ['Seated / dealt in', h.counts ? `${h.counts.seated} / ${h.counts.dealtIn}` : '–'],
      ['Still in the hand', h.counts ? `${h.counts.contesting} (${h.counts.allIn} all-in, ${h.counts.canAct} can act)` : '–'],
      ['Situation', h.counts ? (h.counts.headsUpTable ? 'heads-up table' : `${h.counts.potType} pot at a ${h.counts.dealtIn}-handed table`) : '–'],
    ])));
    const t = el('table', {}, el('tr', {}, el('th', {}, 'Seat'), el('th', {}, 'Player'), el('th', {}, 'Pos'), el('th', { class: 'num' }, 'Stack'), el('th', { class: 'num' }, 'Bet'), el('th', {}, '')));
    for (const p of h.players) t.append(el('tr', {}, el('td', {}, String(p.seat)), el('td', {}, p.name + (p.seat === h.heroSeat ? ' (hero)' : '')), el('td', {}, p.position ?? ''), el('td', { class: 'num' }, String(p.stack)), el('td', { class: 'num' }, p.streetCommit ? String(p.streetCommit) : ''), el('td', { class: 'muted' }, p.folded ? 'folded' : p.allIn ? 'all-in' : p.toAct ? 'to act' : '')));
    grid.append(card('Players', el('div', { class: 'scroll' }, t)));
  }
  if (d) {
    const ct = el('table', {}, el('tr', {}, el('th', {}, 'Action'), el('th', { class: 'num' }, 'EV (chips)'), el('th', { class: 'num' }, '± SE'), el('th', { class: 'num' }, 'Play %')));
    const best = Math.max(...d.candidates.map((c) => c.ev ?? -Infinity));
    for (const c of d.candidates) ct.append(el('tr', {}, el('td', {}, c.label), el('td', { class: 'num' }, c.ev === null ? '–' : `${c.ev.toFixed(1)}${c.ev === best ? '' : ` (${(c.ev - best).toFixed(1)})`}`), el('td', { class: 'num' }, c.evSe === null ? '–' : c.evSe.toFixed(1)), el('td', { class: 'num' }, pct(c.freq))));
    grid.append(card('Decision', el('div', { class: 'big' }, `${d.provisional ? '… ' : ''}${d.label}`),
      dl([
        ['Equity', d.equity ? `${pct(d.equity.equity, 1)} ± ${(196 * d.equity.stdErr).toFixed(1)} vs ${d.equity.opponents} (win ${pct(d.equity.win)}, tie ${pct(d.equity.tie)})` : '–'],
        ['Branch', d.mode],
        ['Compute', `${d.computeMs.toFixed(0)} ms, ${d.samples} samples`],
      ]),
      el('div', { class: 'scroll' }, ct), el('p', { class: 'muted' }, d.uncertainty)));
    grid.append(card('Why',
      el('ul', {}, ...d.basis.map((b) => el('li', {}, b))),
      d.adjustments.length ? el('ul', { class: 'good' }, ...d.adjustments.map((b) => el('li', {}, b))) : el('p', { class: 'muted' }, 'No opponent-specific adjustment.'),
      el('h2', {}, 'Opponent range estimates'),
      el('ul', {}, ...d.ranges.map((r) => el('li', {}, `${r.name} [${r.line}]: ${r.summary}`)))));
  }
  root.append(grid);
}

// ---- opponents ------------------------------------------------------------------

const STAT_COLUMNS: [StatKey, string][] = [['vpip', 'VPIP'], ['pfr', 'PFR'], ['threeBet', '3-bet'], ['foldTo3Bet', 'Fold to 3-bet'], ['cbetFlop', 'C-bet flop'], ['foldToCbetFlop', 'Fold to c-bet'], ['aggFreq', 'Agg freq'], ['wtsd', 'WTSD']];

async function renderOpponents(): Promise<void> {
  const root = $('tab-opponents');
  root.textContent = '';
  const profiles = (await storage.allProfiles()).sort((a, b) => b.hands - a.hands);
  if (!profiles.length) { root.append(card('No profiles yet', el('p', { class: 'muted' }, 'Profiles appear after the first completed hand, or after importing a PokerNow log in Settings.'))); return; }
  const detail = el('div');
  const t = el('table', {}, el('tr', {}, el('th', {}, 'Player'), el('th', { class: 'num' }, 'Hands'), el('th', {}, 'Style'), ...STAT_COLUMNS.map(([, n]) => el('th', { class: 'num' }, n))));
  const show = (p: PlayerProfile, row: HTMLElement) => {
    for (const r of Array.from(t.querySelectorAll('tr.sel'))) r.classList.remove('sel');
    row.classList.add('sel');
    const c = classify(p);
    const notes = exploitNotes(p);
    const all = el('table', {}, el('tr', {}, el('th', {}, 'Statistic'), el('th', { class: 'num' }, 'Did / opportunities'), el('th', { class: 'num' }, 'Raw'), el('th', { class: 'num' }, 'Estimate (90% interval)')));
    for (const k of Object.keys(p.stats) as StatKey[]) {
      const q = posterior(p, k);
      if (q.d === 0) continue;
      all.append(el('tr', {}, el('td', {}, k), el('td', { class: 'num' }, `${q.n} / ${q.d}`), el('td', { class: 'num' }, pct(q.raw)), el('td', { class: 'num' }, `${pct(q.mean)} (${pct(q.lo)}–${pct(q.hi)})`)));
    }
    detail.textContent = '';
    detail.append(el('div', { class: 'grid', style: 'margin-top:12px' },
      card(`${p.name}`, dl([
        ['Identifier', p.playerId], ['Hands observed', String(p.hands)],
        ['Tight-aggressive', pct(c.tightAggressive)], ['Loose-aggressive', pct(c.looseAggressive)], ['Tight-passive', pct(c.tightPassive)], ['Loose-passive', pct(c.loosePassive)], ['Unclassified', pct(c.unclassified)],
      ]), el('p', { class: 'muted' }, 'Style probabilities summarise the statistics; decisions use the statistics, not the label.')),
      card('Behavioural observations',
        notes.length ? el('ul', {}, ...notes.map((n) => el('li', {}, `${n.text}: ${n.evidence}`))) : el('p', { class: 'muted' }, 'Nothing clears the evidence threshold yet.'),
        el('h2', {}, 'Bet sizes (postflop)'), el('div', {}, ...SIZE_BUCKETS.map((b, i) => el('span', { class: 'pill' }, `${b}: ${p.betSizes[i]}${p.shownStrengthN[i] ? ` · shown strength ${pct(p.shownStrengthSum[i] / p.shownStrengthN[i])} (n=${p.shownStrengthN[i]})` : ''}`))),
        el('h2', {}, 'Showdowns'), p.showdowns.length ? el('ul', {}, ...p.showdowns.slice(-8).reverse().map((s) => el('li', {}, `${s.cards} · ${s.line}`))) : el('p', { class: 'muted' }, 'None seen.')),
      card('All statistics', el('div', { class: 'scroll' }, all))));
  };
  for (const p of profiles) {
    const row = el('tr', { class: 'click' }, el('td', {}, p.name), el('td', { class: 'num' }, String(p.hands)), el('td', {}, styleLabel(classify(p))),
      ...STAT_COLUMNS.map(([k]) => { const q = posterior(p, k); return el('td', { class: 'num', title: `${q.n}/${q.d} observed` }, q.d ? `${pct(q.mean)} (${q.d})` : '–'); }));
    row.addEventListener('click', () => show(p, row));
    t.append(row);
  }
  root.append(card('Opponents', el('p', { class: 'muted' }, 'Estimate after shrinkage toward a population prior; the number in brackets is the count of real opportunities. Click a row for detail.'), el('div', { class: 'scroll' }, t)), detail);
}

// ---- hand review ------------------------------------------------------------------

async function renderHands(): Promise<void> {
  const root = $('tab-hands');
  root.textContent = '';
  const hands = await storage.recentHands(300);
  if (!hands.length) { root.append(card('No hands stored yet', el('p', { class: 'muted' }, 'Completed hands are stored locally as they are observed.'))); return; }
  const detail = el('div');
  const t = el('table', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Table'), el('th', {}, 'Hero'), el('th', {}, 'Board'), el('th', { class: 'num' }, 'Players'), el('th', { class: 'num' }, 'Hero net (bb)'), el('th', {}, 'Status')));
  const show = async (h: HandRecord, row: HTMLElement) => {
    for (const r of Array.from(t.querySelectorAll('tr.sel'))) r.classList.remove('sel');
    row.classList.add('sel');
    const name = (seat: number) => { const s = h.seats.find((x) => x.seat === seat); return s ? `${s.name}${s.position ? ` (${s.position})` : ''}` : `seat ${seat}`; };
    const decisions: DecisionRecord[] = await storage.decisionsForHand(h.handId);
    const lines = el('ol');
    let street = '';
    for (const e of h.events) {
      if (e.street !== street) { street = e.street; lines.append(el('li', { class: 'muted', style: 'list-style:none;margin-left:-18px' }, `— ${street} —`)); }
      const text = `${name(e.seat)} ${e.kind.replace('post-', 'posts ')}${e.kind === 'bet' || e.kind === 'raise' ? ` to ${e.to}` : e.amount ? ` ${e.amount}` : ''}${e.allIn ? ' (all-in)' : ''}`;
      const li = el('li', {}, text);
      // Bot decisions made at this point of the hand.
      for (const d of decisions.filter((x) => x.eventCount === e.seq)) {
        li.append(el('div', { class: 'good' }, `bot: ${d.decision.label}${d.decision.equity ? ` · equity ${pct(d.decision.equity.equity, 1)}` : ''} · ${d.execution ? `${d.execution.status}` : 'shown only'}`),
          el('div', { class: 'muted' }, d.decision.candidates.map((c) => `${c.label}${c.ev !== null ? ` EV ${c.ev.toFixed(1)}` : ''} ${pct(c.freq)}`).join(' · ')),
          el('div', { class: 'muted' }, `${d.decision.basis.join(' | ')} — ${d.decision.uncertainty}`));
      }
      lines.append(li);
    }
    detail.textContent = '';
    detail.append(el('div', { class: 'grid', style: 'margin-top:12px' },
      card('Players', el('ul', {}, ...h.seats.filter((s) => s.dealtIn).map((s) => el('li', {}, `${name(s.seat)}: ${s.startStack} → ${s.endStack}${s.shown ? ` · shows ${s.shown.join(' ')}` : ''}${s.seat === h.heroSeat ? ` · hero ${h.heroCards?.join(' ') ?? ''}` : ''}`)))),
      card(`Action · board ${h.board.join(' ') || '–'}`, lines)));
  };
  for (const h of hands) {
    const row = el('tr', { class: 'click' }, el('td', {}, new Date(h.ts).toLocaleString()), el('td', {}, h.tableId), el('td', {}, h.heroCards?.join(' ') ?? '–'), el('td', {}, h.board.join(' ') || '–'),
      el('td', { class: 'num' }, String(h.seats.filter((s) => s.dealtIn).length)),
      el('td', { class: `num ${h.heroNet === null ? '' : h.heroNet >= 0 ? 'good' : 'bad'}` }, h.heroNet === null ? '–' : (h.heroNet / h.bigBlind).toFixed(1)),
      el('td', { class: h.valid ? 'muted' : 'warn' }, h.valid ? 'complete' : h.observedToEnd ? 'reconstruction invalid' : 'ending not observed'));
    row.addEventListener('click', () => void show(h, row));
    t.append(row);
  }
  const valid = hands.filter((h) => h.valid && h.heroNet !== null);
  const net = valid.reduce((a, h) => a + (h.heroNet as number) / h.bigBlind, 0);
  root.append(card(`Hand review · ${hands.length} most recent`, el('p', { class: 'muted' }, `Hero result over ${valid.length} fully observed hands: ${net.toFixed(1)} bb. Click a hand for the action and the bot's reasoning.`), el('div', { class: 'scroll' }, t)), detail);
}

// ---- diagnostics ------------------------------------------------------------------

async function renderDiag(): Promise<void> {
  const root = $('tab-diag');
  root.textContent = '';
  const rows = await storage.recentDiagnostics(300);
  const t = el('table', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Level'), el('th', {}, 'Source'), el('th', {}, 'Message')));
  for (const r of rows) t.append(el('tr', {}, el('td', {}, new Date(r.ts).toLocaleTimeString()), el('td', { class: r.level === 'error' ? 'bad' : r.level === 'warn' ? 'warn' : 'muted' }, r.level), el('td', {}, r.source), el('td', {}, r.message + (r.data ? ` ${JSON.stringify(r.data).slice(0, 300)}` : ''))));
  const health = live ? Object.entries(live.observation.health) : [];
  root.append(el('div', { class: 'grid' },
    card('Page elements (last read)', health.length ? el('div', {}, ...health.map(([k, ok]) => el('span', { class: `pill ${ok ? 'good' : 'bad'}` }, `${k}: ${ok ? 'found' : 'MISSING'}`))) : el('p', { class: 'muted' }, 'No live table.'),
      el('p', { class: 'muted' }, 'A missing element usually means PokerNow changed its markup. Selectors can be overridden in Settings without rebuilding.'),
      live?.observation.problems.length ? el('ul', { class: 'warn' }, ...live.observation.problems.map((p) => el('li', {}, p))) : null)),
  card(`Log · ${rows.length} most recent`, rows.length ? el('div', { class: 'scroll' }, t) : el('p', { class: 'muted' }, 'Empty.')));
}

// ---- settings ------------------------------------------------------------------

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = sanitizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
  renderStop();
}

function renderSettings(): void {
  const root = $('tab-settings');
  root.textContent = '';
  const numField = (label: string, key: 'exploitWeight' | 'minThinkMs' | 'maxThinkMs' | 'assumedClockMs' | 'minConfidence', step: string) => {
    const i = el('input', { type: 'number', step, value: String(settings[key]), id: `set-${key}` });
    i.addEventListener('change', () => void saveSettings({ [key]: Number(i.value) }).then(() => { i.value = String(settings[key]); }));
    return el('div', {}, el('label', { for: `set-${key}` }, label), i);
  };
  const timeout = el('select', { id: 'set-timeout' }, el('option', { value: 'check-fold' }, 'Check, or fold if a check is not possible'), el('option', { value: 'nothing' }, 'Do nothing (let the site time the seat out)'));
  timeout.value = settings.timeoutAction;
  timeout.addEventListener('change', () => void saveSettings({ timeoutAction: timeout.value as Settings['timeoutAction'] }));
  const panel = el('input', { type: 'checkbox', id: 'set-panel' });
  panel.checked = settings.showPanel;
  panel.addEventListener('change', () => void saveSettings({ showPanel: panel.checked }));
  const sel = el('textarea', { id: 'set-selectors', spellcheck: 'false' });
  sel.value = JSON.stringify(settings.selectorOverrides, null, 2);
  const selMsg = el('span', { class: 'muted' });
  const selBtn = el('button', { class: 'btn', type: 'button' }, 'Save selector overrides');
  selBtn.addEventListener('click', () => {
    try { void saveSettings({ selectorOverrides: JSON.parse(sel.value || '{}') }).then(() => { sel.value = JSON.stringify(settings.selectorOverrides, null, 2); selMsg.textContent = ' Saved.'; }); }
    catch { selMsg.textContent = ' Not valid JSON.'; }
  });
  const file = el('input', { type: 'file', accept: '.csv,.txt', id: 'import-file' });
  const importMsg = el('p', { class: 'muted' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const text = await f.text();
    const lines = /^\uFEFF?entry,at,order/.test(text) ? parseLogCsv(text) : text.split(/\r?\n/);
    const res = replayLog(lines, `log-${f.name.replace(/\W+/g, '-')}`);
    const profiles = new Map<string, PlayerProfile>();
    for (const p of await storage.allProfiles()) profiles.set(p.playerId, p);
    let stored = 0;
    for (const h of res.hands) {
      if (!h.valid) continue;
      const ids = applyHandToProfiles(profiles, h.hand, h.reveals, Date.now());
      if (await storage.saveHand(toHandRecord(h, 'imported-log', Date.now()), ids.map((i) => profiles.get(i)!))) stored++;
    }
    importMsg.textContent = `${res.hands.length} Hold'em hands read, ${res.hands.filter((h) => h.valid).length} replayed cleanly, ${stored} newly stored, ${res.unsupportedHands} other-variant hands skipped, ${res.unknownLines.length} unrecognised lines.`;
  });
  const exportBtn = el('button', { class: 'btn', type: 'button' }, 'Export all local data (JSON)');
  exportBtn.addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await storage.exportAll())], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'poker-bot-data.json' });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const clearBtn = el('button', { class: 'btn', type: 'button' }, 'Delete all profiles, hands and logs');
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Delete every stored opponent profile, hand, decision and diagnostic entry? This cannot be undone.')) return;
    await storage.clear(['profiles', 'hands', 'decisions', 'diagnostics']);
    importMsg.textContent = 'Local data deleted.';
  });
  root.append(el('div', { class: 'grid' },
    card('Play', el('p', { class: 'muted' }, 'Mode and table authorisation are set in the toolbar popup.'),
      numField('Opponent-adjustment weight (0 = baseline only, 1 = full)', 'exploitWeight', '0.1'),
      numField('Minimum state confidence to act (0.4–1)', 'minConfidence', '0.05'),
      numField('Think time before acting, minimum (ms)', 'minThinkMs', '100'),
      numField('Think time before acting, maximum (ms)', 'maxThinkMs', '100'),
      numField('Action clock to assume when the page shows none (ms)', 'assumedClockMs', '1000'),
      el('label', { for: 'set-timeout' }, 'When the clock is nearly out and the state is not trusted'), timeout,
      el('label', {}, panel, ' Show the in-page panel')),
    card('PokerNow selectors', el('p', { class: 'muted' }, 'JSON object of selector overrides, e.g. {"foldBtn": "button.fold"}. Keys are the names in src/bot/adapter/pokernow/dom.ts.'), sel, el('div', { style: 'margin-top:8px' }, selBtn, selMsg)),
    card('Data', el('p', { class: 'muted' }, 'Everything is stored in this browser profile only. Nothing is uploaded.'),
      el('label', { for: 'import-file' }, 'Import a PokerNow log (CSV download) into profiles and hand review'), file, importMsg,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, exportBtn, clearBtn))));
}

// ---- shell ------------------------------------------------------------------------

function renderStop(): void {
  const b = $('estop');
  b.textContent = settings.estop ? 'Stopped. Click to clear' : 'EMERGENCY STOP';
  b.className = settings.estop ? 'clear' : '';
}

function renderTab(): void {
  if (activeTab === 'live') renderLive();
  else if (activeTab === 'opponents') void renderOpponents();
  else if (activeTab === 'hands') void renderHands();
  else if (activeTab === 'diag') void renderDiag();
  else renderSettings();
}

async function init(): Promise<void> {
  settings = sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  live = ((await chrome.storage.session.get('live')).live as LiveState | undefined) ?? null;
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('nav button'))) {
    b.addEventListener('click', () => {
      activeTab = b.dataset.tab as string;
      for (const o of Array.from(document.querySelectorAll('nav button'))) o.setAttribute('aria-selected', String(o === b));
      for (const s of Array.from(document.querySelectorAll('main section'))) (s as HTMLElement).hidden = s.id !== `tab-${activeTab}`;
      renderTab();
    });
  }
  $('estop').addEventListener('click', () => void saveSettings({ estop: !settings.estop }));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'session' && c.live) { live = c.live.newValue as LiveState; if (activeTab === 'live') renderLive(); }
    if (area === 'local' && c.settings) { settings = sanitizeSettings(c.settings.newValue); renderStop(); }
  });
  setInterval(() => { if (activeTab === 'live') renderLive(); }, 5000);
  renderStop();
  renderTab();
}
void init();
