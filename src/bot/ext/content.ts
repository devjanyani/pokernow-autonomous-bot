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

const POLL_MS = 250;

function selectorsWith(overrides: Record<string, string>): SelectorMap {
  const map = { ...SELECTORS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(overrides)) if (typeof map[k] === 'string') map[k] = v;
  return map as SelectorMap;
}

function send(msg: BotMessage): void {
  try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); } catch { /* extension reloaded: ignore */ }
}

// ---- in-page panel (shadow DOM, bottom-left, collapsible, never over the action buttons) ----

class Panel {
  private root: ShadowRoot | null = null;
  private body: HTMLElement | null = null;
  private collapsed = false;
  constructor(private readonly onStop: () => void) {}

  mount(): void {
    if (this.root) return;
    const host = document.createElement('div');
    host.id = 'poker-bot-panel-host';
    host.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483000;';
    this.root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .p{font:12px/1.35 system-ui,sans-serif;color:#e8eaed;background:#16181dee;border:1px solid #3a3f4a;border-radius:8px;width:250px;box-shadow:0 2px 10px #0008}
      .h{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;user-select:none}
      .dot{width:9px;height:9px;border-radius:50%;background:#888}.ok{background:#3ecf6e}.warn{background:#f0b429}.bad{background:#ef5350}
      .t{flex:1;font-weight:600}.b{padding:0 8px 8px;display:grid;gap:4px}
      .row{display:flex;justify-content:space-between;gap:8px}.k{color:#9aa0aa}.act{font-size:14px;font-weight:700;color:#8ab4ff}
      .stop{background:#c62828;color:#fff;border:0;border-radius:5px;padding:5px 8px;font-weight:700;cursor:pointer;width:100%}
      .stop:focus-visible{outline:2px solid #fff}.small{color:#9aa0aa;font-size:11px;overflow-wrap:anywhere}
      .blk{font-weight:700;color:#f0b429}.stat{color:#e8eaed;overflow-wrap:anywhere}
    `;
    const p = document.createElement('div');
    p.className = 'p';
    const head = document.createElement('div');
    head.className = 'h';
    head.innerHTML = '<span class="dot"></span><span class="t">Poker bot</span><span class="m"></span>';
    head.addEventListener('click', () => { this.collapsed = !this.collapsed; if (this.body) this.body.style.display = this.collapsed ? 'none' : 'grid'; });
    this.body = document.createElement('div');
    this.body.className = 'b';
    p.append(head, this.body);
    this.root.append(style, p);
    document.documentElement.appendChild(host);
  }

  unmount(): void { document.getElementById('poker-bot-panel-host')?.remove(); this.root = null; this.body = null; }

  render(l: LiveState): void {
    if (!this.root || !this.body) return;
    const dot = this.root.querySelector('.dot') as HTMLElement;
    const r = l.readiness;
    const worst = [r.observation, r.consistency, r.turn, r.legal, r.decision].some((i) => i.level === 'bad') ? 'bad' : [r.observation, r.consistency, r.turn, r.legal].some((i) => i.level === 'warn') ? 'warn' : l.hand ? 'ok' : '';
    dot.className = `dot ${l.estop ? 'bad' : worst}`;
    (this.root.querySelector('.m') as HTMLElement).textContent = l.estop ? 'STOPPED' : l.acting ? 'AUTO' : l.mode;
    const rows: [string, string][] = [];
    const h = l.hand;
    if (h) {
      rows.push(['Hand', `${h.heroCards?.join(' ') ?? '--'} ${h.heroPosition ? `(${h.heroPosition})` : ''}`]);
      rows.push(['Board', h.board.join(' ') || h.street]);
      rows.push(['Pot', `${h.pot} (${(h.pot / h.bigBlind).toFixed(1)}bb)`]);
      if (h.counts) rows.push(['Players', `${h.counts.contesting}/${h.counts.dealtIn} in · ${h.counts.headsUpTable ? 'HU table' : h.counts.potType}`]);
      const who = (seat: number | null) => { const p = h.players.find((x) => x.seat === seat); return seat === null ? '–' : p ? `${p.position ?? `seat ${seat}`}` : `seat ${seat}`; };
      rows.push(['Turn', l.tracker.turnStatus === 'agree' ? `${who(l.tracker.predictedActor)} ✓` : l.tracker.turnStatus === 'disagree' ? `table ${who(l.tracker.observedActor)} ≠ engine ${who(l.tracker.predictedActor)}` : l.tracker.turnStatus === 'unobserved' ? `${who(l.tracker.predictedActor)} (engine only)` : '–']);
    }
    const d = l.decision;
    if (d?.equity) rows.push(['Equity', `${(100 * d.equity.equity).toFixed(1)}% ±${(196 * d.equity.stdErr).toFixed(1)}`]);
    this.body.textContent = '';
    for (const [k, v] of rows) {
      const r = document.createElement('div'); r.className = 'row';
      const a = document.createElement('span'); a.className = 'k'; a.textContent = k;
      const b = document.createElement('span'); b.textContent = v;
      r.append(a, b); this.body.append(r);
    }
    if (l.recommendation.state === 'blocked') {
      const w = document.createElement('div'); w.className = 'blk'; w.textContent = 'Decision unavailable — state reconciliation required.';
      const why = document.createElement('div'); why.className = 'small'; why.textContent = l.recommendation.reason ?? '';
      this.body.append(w, why);
    }
    if (d && l.mode !== 'manual') {
      const a = document.createElement('div'); a.className = 'act'; a.textContent = `${d.provisional ? '… ' : ''}${d.label}`;
      const s = document.createElement('div'); s.className = 'small';
      s.textContent = d.candidates.filter((c) => c.freq > 0.01 || c.ev !== null).slice(0, 6).map((c) => `${c.label}${c.ev !== null ? ` ${c.ev >= 0 ? '+' : ''}${c.ev.toFixed(0)}` : ''}${c.freq > 0.01 && c.freq < 0.99 ? ` ${(100 * c.freq).toFixed(0)}%` : ''}`).join(' · ');
      this.body.append(a, s);
    }
    if (l.recommendation.state !== 'blocked') { const st = document.createElement('div'); st.className = d ? 'small' : 'stat'; st.textContent = l.status; this.body.append(st); }
    const stop = document.createElement('button');
    stop.className = 'stop'; stop.textContent = l.estop ? 'Stopped (re-enable in the popup)' : 'EMERGENCY STOP';
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
