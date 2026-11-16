// ============================================================
// Table manager. PokerNow gives every game a new id, so the list of known
// tables grows quickly. Two different things can be removed here and they are
// kept apart everywhere on this page:
//
//   authorisation  the permission for automatic play on a table (a setting)
//   history        what was recorded there: hands, recommendations, frames, log lines (local database)
//
// The table that is open right now is never revoked or deleted by a bulk action.
// ============================================================

import { button, check, checkAll, confirmDialog, download, el, empty, nextSort, searchBox, select, sortHeader, stamp, tag, toast } from '../ui/dom';
import type { Ctx } from '../ui/context';
import { ago, describePlan, hasHistory, matches, planTables, sortRows, SortDir, TableEntry, tableEntries } from '../viewmodel';

type SortKey = 'label' | 'lastSeen' | 'hands' | 'frames' | 'auth';
const state = { query: '', show: 'all' as 'all' | 'authorized' | 'history' | 'stale', sort: { key: 'lastSeen' as SortKey, dir: 'desc' as SortDir }, selected: new Set<string>(), staleDays: '7', editing: null as string | null };

async function run(ctx: Ctx, tables: TableEntry[], what: { revoke: boolean; purge: boolean }, title: string, rerender: () => void): Promise<void> {
  const plan = planTables(tables, what);
  if (!plan.revoke.length && !plan.purge.length) { toast('Nothing to do: the selected tables have no authorisation or history to remove.', 'warn'); return; }
  const only = plan.purge.length ? await ctx.storage.profilesOnlyAt(plan.purge) : [];
  const skipped = tables.length - plan.tables.length;
  const res = await confirmDialog({
    title, danger: true, confirmLabel: plan.purge.length ? 'Delete permanently' : 'Revoke',
    lines: describePlan(plan),
    keeps: [
      ...(skipped ? ['The table that is open right now.'] : []),
      ...(plan.purge.length ? ['Opponent profiles, unless you tick the box below. They keep the statistics these hands contributed.'] : ['Stored hands, recordings and profiles.']),
      ...(what.purge && !what.revoke ? ['Authorisations.'] : []),
    ],
    options: plan.purge.length ? [
      { id: 'export', label: 'Save a copy of this history to a file first', checked: false },
      ...(only.length ? [{ id: 'profiles', label: `Also delete the ${only.length} opponent profile(s) of players whose every stored hand is at these tables`, checked: false }] : []),
    ] : [],
    ...(plan.purge.length > 3 ? { typeToConfirm: 'delete' } : {}),
  });
  if (!res) return;
  if (res.export) download(`poker-bot-tables-${stamp()}.json`, JSON.stringify(await ctx.storage.exportTables(plan.purge)));
  const gone = new Set(plan.revoke);
  if (plan.revoke.length) await ctx.saveSettings((cur) => ({ authorizedTables: cur.authorizedTables.filter((t) => !gone.has(t)) }));
  let msg = plan.revoke.length ? `${plan.revoke.length} authorisation(s) revoked. ` : '';
  const stillAuthorised = ctx.settings().authorizedTables;
  // A table that is left with neither an authorisation nor any history has no reason to stay in the list.
  const forget = plan.tables.filter((t) => !stillAuthorised.includes(t.tableId) && !hasHistory(t)).map((t) => t.tableId);
  if (plan.purge.length || forget.length) {
    const rep = await ctx.storage.deleteTables([...plan.purge, ...forget], { protect: ctx.activeTableId(), keepRows: stillAuthorised });
    if (plan.purge.length) msg += `${rep.hands} hand(s), ${rep.decisions} recommendation(s), ${rep.frames} frame(s) and ${rep.diagnostics} log line(s) deleted.`;
    if (res.profiles && only.length) { const pr = await ctx.storage.deleteProfiles(only); await ctx.profilesDeleted(only); msg += ` ${pr.profiles} profile(s) deleted.`; }
  }
  state.selected.clear();
  toast(msg.trim());
  rerender();
}

export async function renderTables(root: HTMLElement, ctx: Ctx): Promise<void> {
  const summaries = await ctx.loadTables();
  const rerender = () => { void renderTables(root, ctx); };
  const hadFocus = document.activeElement?.id === 'tables-search';
  const now = Date.now();
  const active = ctx.activeTableId();
  const days = Number(state.staleDays) || 7;
  const all = tableEntries(summaries, ctx.settings(), active, now, days);
  root.textContent = '';
  for (const id of [...state.selected]) if (!all.some((t) => t.tableId === id && !t.active)) state.selected.delete(id);
  const filtered = all.filter((t) => (state.show === 'all' || (state.show === 'authorized' && t.authorized) || (state.show === 'history' && hasHistory(t)) || (state.show === 'stale' && t.stale)) && matches(state.query, t.label, t.tableId, t.nickname));
  const k = state.sort.key;
  const sorted = sortRows(filtered, (t) => (k === 'label' ? t.label : k === 'lastSeen' ? (t.lastSeen || null) : k === 'hands' ? t.hands : k === 'frames' ? t.frames : Number(t.authorized)), state.sort.dir);
  const onSort = (key: SortKey) => { state.sort = nextSort(state.sort, key, key === 'label' ? 'asc' : 'desc'); rerender(); };
  const inactive = all.filter((t) => !t.active);
  const staleAuth = inactive.filter((t) => t.authorized && t.stale);
  const chosen = all.filter((t) => state.selected.has(t.tableId));

  root.append(el('div', { class: 'statrow' },
    el('div', { class: 'stat' }, el('div', { class: 'label' }, 'Tables known'), el('div', { class: 'statnum' }, String(all.length)), el('div', { class: 'sub' }, active ? 'one is open now' : 'none open now')),
    el('div', { class: 'stat' }, el('div', { class: 'label' }, 'Authorised for automatic play'), el('div', { class: 'statnum' }, String(all.filter((t) => t.authorized).length)), el('div', { class: 'sub' }, `${staleAuth.length} not seen for ${days} days`)),
    el('div', { class: 'stat' }, el('div', { class: 'label' }, 'With stored history'), el('div', { class: 'statnum' }, String(all.filter(hasHistory).length)), el('div', { class: 'sub' }, `${all.reduce((a, t) => a + t.hands, 0)} hands, ${all.reduce((a, t) => a + t.frames, 0)} frames`))));

  root.append(el('div', { class: 'card explain' },
    el('div', {}, el('strong', {}, 'Revoke authorisation'), el('span', { class: 'muted' }, ' removes the permission for automatic play on a table. Nothing recorded is deleted.')),
    el('div', {}, el('strong', {}, 'Delete history'), el('span', { class: 'muted' }, ' permanently removes the hands, recommendations, recorded frames and log lines stored for a table. The authorisation is a separate choice. Opponent profiles are kept unless you ask otherwise.')),
    el('div', { class: 'muted' }, 'The table that is open right now is never included in a bulk action.')));

  root.append(el('div', { class: 'toolbar' },
    searchBox(state.query, 'Search by nickname or table id', (v) => { state.query = v; rerender(); }, 'tables-search'),
    select(state.show, [['all', 'All tables'], ['authorized', 'Authorised'], ['history', 'With history'], ['stale', 'Stale']], (v) => { state.show = v; rerender(); }, 'Show'),
    select(state.staleDays, [['1', 'Stale after 1 day'], ['7', 'Stale after 7 days'], ['30', 'Stale after 30 days']], (v) => { state.staleDays = v; rerender(); }, 'Stale threshold'),
    el('span', { class: 'spacer' }),
    button(`Remove stale authorisations (${staleAuth.length})`, () => run(ctx, staleAuth, { revoke: true, purge: false }, `Revoke ${staleAuth.length} stale authorisation(s)?`, rerender), { disabled: staleAuth.length === 0, id: 'tables-stale', title: `Authorised tables not seen for ${days} days. History is kept.` }),
    button(`Remove all inactive tables (${inactive.length})`, () => run(ctx, inactive, { revoke: true, purge: true }, `Remove all ${inactive.length} inactive table(s)?`, rerender), { tone: 'danger', disabled: inactive.length === 0, id: 'tables-all', title: 'Revokes and deletes the history of every table except the one open now.' })));

  root.append(el('div', { class: `toolbar selbar${chosen.length ? '' : ' idle'}` },
    el('span', { class: 'strong' }, `${chosen.length} selected`),
    button('Revoke authorisation', () => run(ctx, chosen, { revoke: true, purge: false }, `Revoke the authorisation of ${chosen.length} table(s)?`, rerender), { disabled: !chosen.some((t) => t.authorized), id: 'tables-revoke' }),
    button('Delete history', () => run(ctx, chosen, { revoke: false, purge: true }, `Delete the history of ${chosen.length} table(s)?`, rerender), { tone: 'danger', disabled: !chosen.some(hasHistory), id: 'tables-purge' }),
    button('Revoke and delete history', () => run(ctx, chosen, { revoke: true, purge: true }, `Remove ${chosen.length} table(s) completely?`, rerender), { tone: 'danger', disabled: chosen.length === 0, id: 'tables-remove' }),
    button('Export history', async () => { download(`poker-bot-tables-${stamp()}.json`, JSON.stringify(await ctx.storage.exportTables(chosen.map((t) => t.tableId)))); }, { disabled: !chosen.some(hasHistory), title: 'Contains player names and table ids. Stays on this computer.' })));

  const selectable = sorted.filter((t) => !t.active).map((t) => t.tableId);
  const head = el('tr', {}, el('th', { class: 'chk' }, checkAll(state.selected, selectable, rerender)),
    sortHeader('Table', 'label', state.sort, onSort), sortHeader('Authorisation', 'auth', state.sort, onSort), sortHeader('Last seen', 'lastSeen', state.sort, onSort),
    sortHeader('Hands', 'hands', state.sort, onSort, 'num'), sortHeader('Frames', 'frames', state.sort, onSort, 'num'), el('th', { class: 'num' }, 'Log lines'), el('th', {}, ''));
  const body = el('tbody');
  for (const t of sorted) {
    let name: HTMLElement;
    if (state.editing === t.tableId) {
      const input = el('input', { type: 'text', maxlength: '40', placeholder: 'Nickname', 'aria-label': `Nickname for ${t.tableId}` });
      input.value = t.nickname;
      const save = async () => { await ctx.storage.setNickname(t.tableId, input.value); state.editing = null; rerender(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { state.editing = null; rerender(); } });
      name = el('div', { class: 'nickedit' }, input, button('Save', save, { tone: 'primary' }), button('Cancel', () => { state.editing = null; rerender(); }, { tone: 'quiet' }));
      setTimeout(() => input.focus(), 0);
    } else {
      name = el('div', {}, el('div', { class: 'strong' }, t.label, t.active ? tag('open now', 'accent') : null, t.stale ? tag('stale', 'muted', `Not seen for ${days} days`) : null),
        el('div', { class: 'sub mono', title: t.tableId }, t.tableId));
    }
    body.append(el('tr', { class: t.active ? 'activerow' : '', 'data-id': t.tableId },
      el('td', { class: 'chk' }, check(state.selected, t.tableId, rerender, `Select table ${t.label}`, t.active)),
      el('td', {}, name),
      el('td', {}, t.authorized ? tag('authorised', 'good') : tag('not authorised', 'muted')),
      el('td', { class: 'nowrap' }, t.lastSeen ? el('div', {}, ago(t.lastSeen, now)) : el('span', { class: 'muted' }, 'never recorded'), t.lastSeen ? el('div', { class: 'sub' }, new Date(t.lastSeen).toLocaleDateString()) : null),
      el('td', { class: 'num' }, String(t.hands)), el('td', { class: 'num' }, String(t.frames)), el('td', { class: 'num' }, String(t.diagnostics)),
      el('td', { class: 'nowrap' }, state.editing === t.tableId ? null : button(t.nickname ? 'Rename' : 'Add nickname', () => { state.editing = t.tableId; rerender(); }, { tone: 'quiet' }))));
  }
  root.append(el('div', { class: 'card flush' },
    el('div', { class: 'tablewrap' }, el('table', { class: 'data', id: 'tables-table' }, el('thead', {}, head), body)),
    sorted.length ? null : empty(all.length ? 'No table matches' : 'No tables yet', all.length ? 'Change the search or the filter.' : 'A table appears here once it has been opened with the extension installed.')));
  if (hadFocus) { const s = root.querySelector<HTMLInputElement>('#tables-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
}
