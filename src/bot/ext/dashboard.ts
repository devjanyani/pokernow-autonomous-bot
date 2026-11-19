// ============================================================
// Dashboard (extension page): shell, navigation and the Live tab. The other
// tabs are in ./tabs. Reads the extension's own IndexedDB directly and the live
// snapshot from chrome.storage.session. All text from the table (player names,
// log lines) is inserted with textContent, never as HTML.
// ============================================================

import { LiveState, patchSettings, sanitizeSettings, Settings } from './records';
import { BotStorage } from './storage';
import { renderDiag, diagBusy } from './tabs/diag';
import { renderHands } from './tabs/hands';
import { renderOpponents } from './tabs/opponents';
import { renderSettings } from './tabs/settings';
import { renderTables } from './tabs/tables';
import type { Ctx } from './ui/context';
import { $, card, dl, el, playingCard, tag } from './ui/dom';
import { actorLine, cardView, chips, contextRows, decisionBanner, explanation, playerRows, recentTimeline, shadowRows, statusPill, strategyTag } from './view';
import { pct, tableLabel } from './viewmodel';

const storage = new BotStorage();
const TABS = ['live', 'opponents', 'hands', 'tables', 'diag', 'settings'];
let settings: Settings;
let live: LiveState | null = null;
let activeTab = 'live';
let nicknames = new Map<string, string>();

async function saveSettings(change: Partial<Settings> | ((cur: Settings) => Partial<Settings>)): Promise<void> {
  settings = await patchSettings(chrome.storage.local, change);
  renderStop();
}

const ctx: Ctx = {
  storage,
  settings: () => settings,
  saveSettings,
  live: () => live,
  activeTableId: () => (live && Date.now() - live.ts < 60000 && live.tableId !== 'unknown' ? live.tableId : null),
  nicknames: () => nicknames,
  loadTables: async () => {
    const t = await storage.tableSummaries();
    nicknames = new Map(t.filter((x) => x.nickname).map((x) => [x.tableId, x.nickname]));
    return t;
  },
  profilesDeleted: async (ids) => { if (ids.length) await chrome.storage.local.set({ profilesDeleted: { ids: ids.slice(0, 5000), at: Date.now() } }); },
  rerender: () => renderTab(),
  goto: (tab) => selectTab(tab),
  version: chrome.runtime.getManifest().version,
};

// ---- live ---------------------------------------------------------------------

function renderLive(): void {
  const root = $('tab-live');
  root.textContent = '';
  const now = Date.now();
  const pill = statusPill(live, now);
  const banner = decisionBanner(live, now);
  const l = live && now - live.ts <= 60000 ? live : null;
  const h = l?.hand ?? null;
  const strat = strategyTag(l);

  // ---- status line: one compact indicator; the detail lives on the Diagnostics tab ----
  const stratTag = strat ? tag(`Strategy: ${strat.text}`, strat.tone, strat.detail) : null;
  if (stratTag) stratTag.id = 'strategy-tag';
  root.append(el('div', { class: 'statusline' },
    el('span', { class: `statuspill ${pill.tone}`, id: 'status-pill' }, pill.label),
    el('span', { class: 'muted' }, pill.detail),
    l ? el('span', { class: 'spacer' }) : null,
    stratTag,
    l ? tag(l.estop ? 'Emergency stop on' : l.acting ? 'Autonomous' : l.mode === 'manual' ? 'Manual' : 'Recommend only', l.estop ? 'warn' : 'muted') : null));

  // ---- table: hero and board ----
  const heroCards = h?.heroCards ?? null;
  const hero = el('div', { class: 'hero' },
    el('div', { class: 'cards' }, playingCard(heroCards ? heroCards[0] : null, 'lg', !heroCards), playingCard(heroCards ? heroCards[1] : null, 'lg', !heroCards)),
    el('div', { class: 'heroinfo' },
      el('div', { class: 'label' }, 'Your hand'),
      el('div', { class: 'posline' }, h?.heroPosition ? el('span', { class: 'posbadge' }, h.heroPosition) : null, el('span', {}, heroCards ? heroCards.map((c) => { const v = cardView(c); return `${v.rank}${v.suit}`; }).join(' ') : 'Not dealt in')),
      el('div', { class: 'muted' }, h && h.heroStack !== null ? `Stack ${chips(h.heroStack)}${h.bigBlind ? ` · ${(h.heroStack / h.bigBlind).toFixed(0)} bb` : ''}` : 'Stack –'),
      el('div', { class: 'muted' }, h && h.effectiveStackBB !== null ? `Effective stack ${h.effectiveStackBB.toFixed(1)} bb` : 'Effective stack –')));
  const boardCards = h?.board ?? [];
  const board = el('div', { class: 'boardwrap' },
    el('div', { class: 'label' }, h ? `Board · ${h.phase === 'complete' ? 'hand complete' : h.phase}` : 'Board'),
    el('div', { class: 'cards', id: 'board' }, ...Array.from({ length: 5 }, (_, i) => playingCard(boardCards[i] ?? null, 'md', true))),
    el('div', { class: 'potline' }, h ? `Pot ${chips(h.pot)}` : 'No hand in progress'));
  root.append(el('div', { class: 'card tablecard' }, hero, board));

  // ---- decision: never blank ----
  const dec = el('div', { class: `card decision ${banner.tone}`, id: 'decision' });
  dec.append(el('div', { class: 'label' }, banner.kind === 'action' ? 'Recommended action' : 'Decision'));
  dec.append(el('div', { class: banner.kind === 'action' ? 'big' : 'msg' }, `${banner.provisional ? '… ' : ''}${banner.title}`));
  if (banner.sub) dec.append(el('div', { class: 'sub' }, banner.sub));
  if (l && l.decision && banner.kind === 'action' && strat && (strat.fallback || l.strategy?.selected === 'v3')) {
    dec.append(el('div', { class: `sub ${strat.fallback ? 'warn' : ''}`, id: 'strategy-note' }, strat.detail));
  }
  if (l && l.decision && banner.kind === 'action') {
    const d = l.decision;
    const why = explanation(l, true);
    if (why.length) dec.append(el('div', { class: 'label', style: 'margin-top:12px' }, 'Why'), el('ul', { class: 'why' }, ...why.map((w) => el('li', {}, w))));
    const ct = el('table', { class: 'compact' }, el('tr', {}, el('th', {}, 'Option'), el('th', { class: 'num' }, 'EV (chips)'), el('th', { class: 'num' }, '± SE'), el('th', { class: 'num' }, 'Play %')));
    const best = Math.max(...d.candidates.map((c) => c.ev ?? -Infinity));
    for (const c of d.candidates) ct.append(el('tr', {}, el('td', {}, c.label), el('td', { class: 'num' }, c.ev === null ? '–' : `${c.ev.toFixed(1)}${c.ev === best ? '' : ` (${(c.ev - best).toFixed(1)})`}`), el('td', { class: 'num' }, c.evSe === null ? '–' : c.evSe.toFixed(1)), el('td', { class: 'num' }, pct(c.freq))));
    const more = el('details', { class: 'more' }, el('summary', {}, 'All options considered, full reasoning and opponent ranges'), ct,
      el('ul', { class: 'why' }, ...explanation(l).map((w) => el('li', {}, w))),
      d.ranges.length ? el('ul', { class: 'why' }, ...d.ranges.map((r) => el('li', {}, `${r.name} [${r.line}]: ${r.summary}`))) : null,
      el('p', { class: 'muted' }, `${d.strategy ? `decided by ${d.strategy.used}${d.strategy.requested !== d.strategy.used ? ` (${d.strategy.requested} selected)` : ''} · ` : ''}${d.mode} · ${d.samples} samples · ${d.computeMs.toFixed(0)} ms. EV is shown only where the engine computed one.`));
    more.open = liveMoreOpen;
    more.addEventListener('toggle', () => { liveMoreOpen = more.open; });
    dec.append(more);
  }
  root.append(dec);
  const sh = shadowRows(l);
  if (sh.length) { const c = card('Shadow comparison (diagnostic only)', dl(sh)); c.id = 'shadow'; root.append(c); }

  if (!l) return;

  // ---- context, players, timeline ----
  const actor = actorLine(l);
  const ctx = card('Game', el('div', { class: `actor ${actor.tone}`, id: 'actor' }, actor.text, actor.verified ? tag('confirmed', 'good') : null), dl(contextRows(l).map(([k, v]) => [k, v])));
  const rows = playerRows(l);
  const plist = el('div', { class: 'players', id: 'players' }, el('div', { class: 'prow head' }, el('span', {}, 'Player'), el('span', {}, 'Pos'), el('span', { class: 'num' }, 'Stack'), el('span', {}, 'Last action'), el('span', {}, 'Status')));
  for (const p of rows) {
    plist.append(el('div', { class: `prow ${p.kind}${p.isHero ? ' hero' : ''}` },
      el('span', { class: 'pname', title: p.name }, p.name, p.isHero ? tag('you', 'accent') : null),
      el('span', {}, p.position), el('span', { class: 'num' }, p.stack), el('span', { class: 'pact' }, p.lastAction),
      el('span', { class: 'pstatus' }, p.status)));
  }
  const tl = el('div', { class: 'tl', id: 'timeline' });
  for (const e of recentTimeline(l, 14)) {
    if (e.street) tl.append(el('div', { class: 'tlstreet' }, e.street));
    tl.append(el('div', { class: `tlrow${e.uncertain ? ' bad' : ''}` }, e.text, e.deduced ? tag(e.uncertain ? 'deduced, unconfirmed' : 'deduced', e.uncertain ? 'bad' : 'warn') : null));
  }
  root.append(el('div', { class: 'livecols' }, ctx, card('Players', plist), card('Recent actions', l.timeline.length ? tl : el('p', { class: 'muted' }, 'No actions yet.'))));
}
let liveMoreOpen = false;

// ---- shell ------------------------------------------------------------------------

function renderStop(): void {
  const b = $('estop');
  b.textContent = settings.estop ? 'Stopped. Click to clear' : 'EMERGENCY STOP';
  b.className = settings.estop ? 'clear' : '';
  const chip = $('tablechip');
  const id = ctx.activeTableId();
  chip.textContent = id ? tableLabel(id, nicknames) : 'No table open';
  chip.title = id ?? '';
  chip.className = `tablechip${id ? ' on' : ''}`;
}

function renderTab(): void {
  if (activeTab === 'live') renderLive();
  else if (activeTab === 'opponents') void renderOpponents($('tab-opponents'), ctx);
  else if (activeTab === 'hands') void renderHands($('tab-hands'), ctx);
  else if (activeTab === 'tables') void renderTables($('tab-tables'), ctx);
  else if (activeTab === 'diag') void renderDiag($('tab-diag'), ctx);
  else renderSettings($('tab-settings'), ctx);
}

function selectTab(tab: string): void {
  activeTab = TABS.includes(tab) ? tab : 'live';
  for (const o of Array.from(document.querySelectorAll('nav button'))) o.setAttribute('aria-selected', String((o as HTMLElement).dataset.tab === activeTab));
  for (const s of Array.from(document.querySelectorAll('main > section'))) (s as HTMLElement).hidden = s.id !== `tab-${activeTab}`;
  if (location.hash !== `#${activeTab}`) history.replaceState(null, '', `#${activeTab}`);
  window.scrollTo(0, 0);
  renderTab();
}

async function init(): Promise<void> {
  settings = sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  live = ((await chrome.storage.session.get('live')).live as LiveState | undefined) ?? null;
  await ctx.loadTables().catch(() => undefined);
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('nav button'))) b.addEventListener('click', () => selectTab(b.dataset.tab as string));
  $('estop').addEventListener('click', () => void saveSettings((cur) => ({ estop: !cur.estop })));
  addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t !== activeTab) selectTab(t); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'session' && c.live) {
      const prev = live;
      live = c.live.newValue as LiveState;
      if (prev?.tableId !== live?.tableId) renderStop();
      if (activeTab === 'live') renderLive();
      // The diagnostics tab is redrawn only when the reconstruction changed and nobody is working in it.
      else if (activeTab === 'diag' && live && (!prev || prev.timeline.length !== live.timeline.length || prev.hand?.handId !== live.hand?.handId || prev.tracker.turnStatus !== live.tracker.turnStatus || prev.tracker.blockers.join() !== live.tracker.blockers.join()) && !diagBusy()) void renderDiag($('tab-diag'), ctx);
    }
    if (area === 'local' && c.settings) {
      settings = sanitizeSettings(c.settings.newValue);
      renderStop();
      if (activeTab === 'tables' && !document.querySelector('dialog[open]')) renderTab();
    }
  });
  setInterval(() => { if (activeTab === 'live') renderLive(); }, 2000);
  renderStop();
  selectTab(location.hash.slice(1) || 'live');
}
void init();
