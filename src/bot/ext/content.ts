// ============================================================
// Content script: wires the PokerNow DOM adapter to the LiveController and
// draws the small in-page status panel. All poker computation happens here,
// in time-sliced batches that yield to the page between slices (no worker,
// no network, nothing that depends on the service worker staying alive).
// ============================================================

import { PokerNowDom, SELECTORS, SelectorMap } from '../adapter/pokernow/dom';
import { sanitizeProfile } from '../opponents/profile';
import { LiveController } from './controller';
import { BotMessage, DEFAULT_SETTINGS, LiveState, sanitizeSettings, Settings } from './records';
import { actorLine, cardView, chips, decisionBanner, statusPill } from './view';

const POLL_MS = 250;

function selectorsWith(overrides: Record<string, string>): SelectorMap {
  const map = { ...SELECTORS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(overrides)) if (typeof map[k] === 'string') map[k] = v;
  return map as SelectorMap;
}

function send(msg: BotMessage): void {
  try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); } catch { /* extension reloaded: ignore */ }
}

// ---- in-page overlay (closed shadow DOM; small, movable, minimisable) ----
// Shows only: hero cards, position, pot, players remaining, current actor, and the recommendation or
// the reason there is none. Everything else is on the dashboard.

interface PanelUi { left: number; top: number; collapsed: boolean }

class Panel {
  private root: ShadowRoot | null = null;
  private host: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private ui: PanelUi = { left: 8, top: 8, collapsed: false };
  private last: LiveState | null = null;
  constructor(private readonly onStop: () => void) {}

  private place(): void {
    if (!this.host) return;
    const maxL = Math.max(0, window.innerWidth - 60), maxT = Math.max(0, window.innerHeight - 30);
    this.ui.left = Math.min(Math.max(0, this.ui.left), maxL); this.ui.top = Math.min(Math.max(0, this.ui.top), maxT);
    this.host.style.left = `${this.ui.left}px`; this.host.style.top = `${this.ui.top}px`;
  }
  private saveUi(): void { try { void chrome.storage.local.set({ panelUi: this.ui }); } catch { /* extension reloaded */ } }

  mount(): void {
    if (this.root) return;
    const host = document.createElement('div');
    host.id = 'poker-bot-panel-host';
    host.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483000;';
    this.host = host;
    this.root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .p{font:12px/1.35 system-ui,sans-serif;color:#e8eaed;background:#15171cf2;border:1px solid #333944;border-radius:10px;width:232px;box-shadow:0 4px 14px #000a}
      .h{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:move;user-select:none;touch-action:none}
      .dot{width:8px;height:8px;border-radius:50%;background:#7c828d;flex:none}.good{background:#3ecf6e}.warn{background:#f0b429}.bad{background:#ef5350}
      .t{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ib{font:inherit;color:#9aa0aa;background:transparent;border:0;border-radius:4px;padding:0 5px;cursor:pointer;line-height:1.4}.ib:hover{color:#fff;background:#2a2f39}
      .ib:focus-visible,.stop:focus-visible{outline:2px solid #8ab4ff}
      .b{padding:2px 10px 10px;display:grid;gap:7px}
      .top{display:flex;align-items:center;gap:8px}
      .cards{display:flex;gap:3px}
      .pc{display:inline-grid;grid-template-rows:1fr 1fr;place-items:center;width:26px;height:36px;border-radius:4px;background:#f5f2ea;color:#14161b;font-weight:700;font-size:13px;line-height:1}
      .pc.red{color:#c0271f}.pc.none{background:transparent;border:1px dashed #3a404b}
      .pos{font-size:11px;font-weight:700;color:#15171c;background:#8ab4ff;border-radius:4px;padding:0 5px}
      .meta{display:grid;gap:1px;min-width:0}.k{color:#9aa0aa}
      .actor{color:#9aa0aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.actor.me{color:#8ab4ff;font-weight:600}
      .act{font-size:19px;font-weight:700;color:#8ab4ff;line-height:1.15}
      .msg{font-size:13px;font-weight:600}.msg.bad{color:#ef5350}.msg.warn{color:#f0b429}
      .sub{color:#9aa0aa;font-size:11px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .stop{background:transparent;color:#ef5350;border:1px solid #6a2b2a;border-radius:6px;padding:4px 8px;font:inherit;font-weight:700;cursor:pointer;width:100%}
      .stop:hover{background:#c62828;color:#fff}.stop:disabled{color:#9aa0aa;border-color:#333944;cursor:default;background:transparent}
    `;
    const p = document.createElement('div');
    p.className = 'p';
    const head = document.createElement('div');
    head.className = 'h';
    head.title = 'Drag to move';
    const dot = document.createElement('span'); dot.className = 'dot';
    const title = document.createElement('span'); title.className = 't'; title.textContent = 'Poker bot';
    const min = document.createElement('button'); min.className = 'ib'; min.type = 'button'; min.setAttribute('aria-label', 'Minimise or expand the panel');
    head.append(dot, title, min);
    min.addEventListener('click', (e) => { e.stopPropagation(); this.ui.collapsed = !this.ui.collapsed; this.saveUi(); if (this.last) this.render(this.last); else this.applyCollapsed(); });
    // Drag by the header (pointer events; position is remembered).
    let drag: { x: number; y: number; left: number; top: number } | null = null;
    head.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).tagName === 'BUTTON') return; drag = { x: e.clientX, y: e.clientY, left: this.ui.left, top: this.ui.top }; head.setPointerCapture(e.pointerId); });
    head.addEventListener('pointermove', (e) => { if (!drag) return; this.ui.left = drag.left + e.clientX - drag.x; this.ui.top = drag.top + e.clientY - drag.y; this.place(); });
    const end = () => { if (drag) { drag = null; this.saveUi(); } };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
    this.body = document.createElement('div');
    this.body.className = 'b';
    p.append(head, this.body);
    this.root.append(style, p);
    document.documentElement.appendChild(host);
    try { void chrome.storage.local.get('panelUi').then((r) => { const u = r.panelUi as Partial<PanelUi> | undefined; if (u && Number.isFinite(u.left) && Number.isFinite(u.top)) { this.ui = { left: Number(u.left), top: Number(u.top), collapsed: u.collapsed === true }; this.place(); this.applyCollapsed(); } }); } catch { /* defaults */ }
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    if (!this.root || !this.body) return;
    this.body.style.display = this.ui.collapsed ? 'none' : 'grid';
    const b = this.root.querySelector('.ib') as HTMLElement;
    b.textContent = this.ui.collapsed ? '▸' : '–';
  }

  unmount(): void { document.getElementById('poker-bot-panel-host')?.remove(); this.root = null; this.body = null; this.host = null; }

  render(l: LiveState): void {
    if (!this.root || !this.body) return;
    this.last = l;
    const now = Date.now();
    const pill = statusPill(l, now);
    const banner = decisionBanner(l, now);
    const dot = this.root.querySelector('.dot') as HTMLElement;
    dot.className = `dot ${pill.tone === 'muted' || pill.tone === 'accent' ? '' : pill.tone}`;
    dot.title = `${pill.label}: ${pill.detail}`;
    // Minimised: the header alone still carries the recommendation or status.
    (this.root.querySelector('.t') as HTMLElement).textContent = this.ui.collapsed ? banner.title : `Poker bot · ${pill.label}`;
    this.applyCollapsed();
    const mk = (tagName: string, cls: string, text = ''): HTMLElement => { const e = document.createElement(tagName); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    this.body.textContent = '';
    const h = l.hand;
    const top = mk('div', 'top');
    const cards = mk('div', 'cards');
    for (let i = 0; i < 2; i++) {
      const c = h?.heroCards?.[i];
      if (!c) { cards.append(mk('span', 'pc none')); continue; }
      const v = cardView(c);
      const pc = mk('span', `pc${v.red ? ' red' : ''}`); pc.setAttribute('aria-label', v.label);
      pc.append(mk('span', '', v.rank), mk('span', '', v.suit));
      cards.append(pc);
    }
    const meta = mk('div', 'meta');
    const line1 = mk('div', '');
    if (h?.heroPosition) { line1.append(mk('span', 'pos', h.heroPosition), document.createTextNode(' ')); }
    line1.append(document.createTextNode(h ? `Pot ${chips(h.pot)}` : 'No hand'));
    meta.append(line1);
    if (h?.counts) meta.append(mk('div', 'k', `${h.counts.contesting} of ${h.counts.dealtIn} players in`));
    top.append(cards, meta);
    this.body.append(top);
    if (h && h.phase !== 'complete') { const a = actorLine(l); this.body.append(mk('div', `actor${a.tone === 'accent' ? ' me' : ''}`, a.text)); }
    this.body.append(mk('div', banner.kind === 'action' ? 'act' : `msg ${banner.tone === 'bad' || banner.tone === 'warn' ? banner.tone : ''}`, `${banner.provisional ? '… ' : ''}${banner.title}`));
    if (banner.sub) this.body.append(mk('div', 'sub', banner.sub));
    const stop = document.createElement('button');
    stop.className = 'stop'; stop.type = 'button'; stop.textContent = l.estop ? 'Stopped (clear in the popup)' : 'Emergency stop';
    stop.disabled = l.estop;
    stop.addEventListener('click', (e) => { e.stopPropagation(); this.onStop(); });
    this.body.append(stop);
  }
}

// ---- bootstrap ----------------------------------------------------------------

async function loadSettings(): Promise<Settings> {
  try { return sanitizeSettings((await chrome.storage.local.get('settings')).settings); } catch { return DEFAULT_SETTINGS; }
}

async function main(): Promise<void> {
  let settings = await loadSettings();
  let dom = new PokerNowDom(document, selectorsWith(settings.selectorOverrides));
  // eslint-disable-next-line prefer-const -- assigned once below; the panel callback needs the binding first
  let controller: LiveController;
  const panel = new Panel(() => {
    // Disarm locally first (instant), then persist so every tab and the popup see it.
    settings = { ...settings, estop: true };
    controller.updateSettings(settings);
    void chrome.storage.local.set({ settings });
  });
  // Yield through a MessageChannel: a macrotask that is not throttled like setTimeout in background tabs.
  const yieldFn = (): Promise<void> => new Promise((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); ch.port2.postMessage(0); });
  controller = new LiveController({
    observe: () => dom.observe(performance.now()),
    health: () => dom.health(),
    driver: { click: (k) => dom.click(k), betOrRaise: (to) => dom.betOrRaise(to) },
    send,
    loadProfiles: (ids) => new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'bot/loadProfiles', ids }, (resp) => {
          void chrome.runtime.lastError;
          resolve(Array.isArray(resp?.profiles) ? resp.profiles.map(sanitizeProfile) : []);
        });
      } catch { resolve([]); }
    }),
    now: () => performance.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    yieldFn,
    random: Math.random,
    render: (l) => panel.render(l),
  }, settings, (Date.now() & 0x7fffffff) >>> 0);
  if (settings.showPanel) panel.mount();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const next = sanitizeSettings(changes.settings.newValue);
    if (JSON.stringify(next.selectorOverrides) !== JSON.stringify(settings.selectorOverrides)) dom = new PokerNowDom(document, selectorsWith(next.selectorOverrides));
    settings = next;
    if (settings.showPanel) panel.mount(); else panel.unmount();
    controller.updateSettings(settings);
  });

  let scheduled = false;
  const tick = () => {
    scheduled = false;
    try { controller.tick(); } catch (e) { send({ type: 'bot/diag', record: { ts: Date.now(), level: 'error', source: 'content', message: `tick failed: ${(e as Error).message}` } }); }
  };
  setInterval(tick, POLL_MS);
  // Hand any recorded frames to storage before the page goes away.
  addEventListener('pagehide', () => controller.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') controller.flush(); });
  // React to page changes sooner than the poll, coalesced to one read per frame.
  new MutationObserver(() => { if (!scheduled) { scheduled = true; setTimeout(tick, 40); } }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  send({ type: 'bot/diag', record: { ts: Date.now(), level: 'info', source: 'content', message: `attached to ${location.pathname} in ${settings.mode} mode` } });
}

if (/(^|\.)pokernow\.(club|com)$/.test(location.hostname)) void main();
