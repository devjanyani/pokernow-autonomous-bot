// Popup: mode, this table's authorisation, emergency stop. Talks to the rest only through chrome.storage.
// Previous tables are managed on the dashboard's Tables tab; the popup only counts them.
import { LiveState, mayAct, Mode, patchSettings, sanitizeSettings, Settings } from './records';
import { BotStorage } from './storage';
import { shortId } from './viewmodel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settings: Settings;
let tableId: string | null = null;
let nickname = '';

async function save(change: Partial<Settings> | ((cur: Settings) => Partial<Settings>)): Promise<void> {
  settings = await patchSettings(chrome.storage.local, change);
  render();
}

/** What the popup shows for a state. Pure, so it can be tested without a browser. */
export function popupView(s: Settings, table: string | null, nick: string): { state: string; tone: 'good' | 'warn' | 'bad' | ''; tableName: string; tableId: string; authTag: string; authorised: boolean; others: string } {
  const authorised = table !== null && s.authorizedTables.includes(table);
  const acting = table !== null && mayAct(s, table);
  const other = s.authorizedTables.filter((t) => t !== table).length;
  return {
    state: s.estop ? 'Emergency stop is ON: nothing will be clicked.'
      : acting ? 'ACTING automatically on this table.'
        : s.mode === 'autonomous' && s.strategyEngine === 'v3' ? 'Autonomous selected, but strategy v3 (experimental) is recommendation-only: nothing is clicked.'
          : s.mode === 'autonomous' ? (table ? 'Autonomous selected, but this table is not authorised: recommending only.' : 'Autonomous selected. No table is open.')
            : s.mode === 'recommend' ? `Recommending only${s.strategyEngine === 'v3' ? ' (strategy v3, experimental)' : ''}. Nothing is clicked.` : 'Observing only.',
    tone: s.estop ? 'bad' : acting ? 'warn' : s.mode === 'manual' ? '' : 'good',
    tableName: table ? (nick || shortId(table)) : 'Not on a PokerNow table',
    tableId: table && (nick || table.length > 11) ? table : '',
    authTag: !table ? '–' : authorised ? 'authorised' : 'not authorised',
    authorised,
    others: other === 0 ? 'No other table is authorised.' : `${other} other table${other === 1 ? ' is' : 's are'} authorised.`,
  };
}

function render(): void {
  const v = popupView(settings, tableId, nickname);
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name=mode]'))) r.checked = r.value === settings.mode;
  $<HTMLInputElement>('auth').checked = settings.authorizationConfirmed;
  $('tablename').textContent = v.tableName;
  $('tableid').textContent = v.tableId;
  $('tableid').title = v.tableId;
  $('authtag').textContent = v.authTag;
  $('authtag').className = `tag ${v.authorised ? 'good' : 'muted'}`;
  $('others').textContent = v.others;
  $<HTMLButtonElement>('allow').disabled = !tableId || !settings.authorizationConfirmed || v.authorised;
  $<HTMLButtonElement>('revoke').disabled = !tableId || !v.authorised;
  const stop = $('stop');
  stop.textContent = settings.estop ? 'Stopped. Click to clear the emergency stop' : 'EMERGENCY STOP';
  stop.className = settings.estop ? 'clear' : '';
  $('state').textContent = v.state;
  $('state').className = v.tone;
}

async function init(): Promise<void> {
  settings = sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  // The live state names the table the content script is attached to (no tabs permission needed).
  const live = (await chrome.storage.session.get('live')).live as LiveState | undefined;
  if (live && Date.now() - live.ts < 15000 && live.tableId !== 'unknown') tableId = live.tableId;
  $('ver').textContent = `v${chrome.runtime.getManifest().version}`;
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name=mode]'))) r.addEventListener('change', () => void save({ mode: r.value as Mode }));
  $('auth').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    // Withdrawing the confirmation withdraws every authorisation with it.
    void save(on ? { authorizationConfirmed: true } : { authorizationConfirmed: false, authorizedTables: [] });
  });
  $('allow').addEventListener('click', () => { const t = tableId; if (t) void save((cur) => ({ authorizedTables: cur.authorizedTables.includes(t) ? cur.authorizedTables : [...cur.authorizedTables, t] })); });
  $('revoke').addEventListener('click', () => { const t = tableId; void save((cur) => ({ authorizedTables: cur.authorizedTables.filter((x) => x !== t) })); });
  $('stop').addEventListener('click', () => void save((cur) => ({ estop: !cur.estop })));
  const open = (hash: string) => void chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash}`) });
  $('dash').addEventListener('click', () => open(''));
  $('manage').addEventListener('click', () => open('#tables'));
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.settings) { settings = sanitizeSettings(c.settings.newValue); render(); } });
  render();
  if (tableId) {
    const id = tableId;
    void new BotStorage().tableSummaries().then((t) => { nickname = t.find((x) => x.tableId === id)?.nickname ?? ''; render(); }).catch(() => undefined);
  }
}
if (typeof chrome !== 'undefined' && chrome.storage) void init();
