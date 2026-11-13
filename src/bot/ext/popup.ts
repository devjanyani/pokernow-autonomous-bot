// Popup: mode, authorisation, emergency stop. Talks to the rest only through chrome.storage.
import { LiveState, mayAct, Mode, sanitizeSettings, Settings } from './records';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settings: Settings;
let tableId: string | null = null;

async function save(patch: Partial<Settings>): Promise<void> {
  settings = sanitizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
  render();
}

function render(): void {
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name=mode]'))) r.checked = r.value === settings.mode;
  $<HTMLInputElement>('auth').checked = settings.authorizationConfirmed;
  $('table').textContent = tableId ?? 'not on a PokerNow table';
  $('tables').textContent = settings.authorizedTables.length ? `Authorised tables: ${settings.authorizedTables.join(', ')}` : 'No table authorised.';
  $<HTMLButtonElement>('allow').disabled = !tableId || !settings.authorizationConfirmed || settings.authorizedTables.includes(tableId);
  $<HTMLButtonElement>('revoke').disabled = !tableId || !settings.authorizedTables.includes(tableId);
  const stop = $('stop');
  stop.textContent = settings.estop ? 'Stopped. Click to clear the emergency stop' : 'EMERGENCY STOP';
  stop.className = settings.estop ? 'clear' : '';
  const acting = tableId !== null && mayAct(settings, tableId);
  $('state').textContent = settings.estop ? 'Emergency stop is ON: nothing will be clicked.'
    : acting ? 'ACTING automatically on this table.'
      : settings.mode === 'autonomous' ? 'Autonomous selected but this table is not authorised: recommending only.'
        : settings.mode === 'recommend' ? 'Recommending only.' : 'Observing only.';
}

async function init(): Promise<void> {
  settings = sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  // The live state names the table the content script is attached to (no tabs permission needed).
  const live = (await chrome.storage.session.get('live')).live as LiveState | undefined;
  if (live && Date.now() - live.ts < 15000 && live.tableId !== 'unknown') tableId = live.tableId;
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name=mode]'))) r.addEventListener('change', () => void save({ mode: r.value as Mode }));
  $('auth').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    void save(on ? { authorizationConfirmed: true } : { authorizationConfirmed: false, authorizedTables: [] });
  });
  $('allow').addEventListener('click', () => { if (tableId) void save({ authorizedTables: [...settings.authorizedTables, tableId] }); });
  $('revoke').addEventListener('click', () => { void save({ authorizedTables: settings.authorizedTables.filter((t) => t !== tableId) }); });
  $('stop').addEventListener('click', () => void save({ estop: !settings.estop }));
  $('dash').addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.settings) { settings = sanitizeSettings(c.settings.newValue); render(); } });
  render();
}
void init();
