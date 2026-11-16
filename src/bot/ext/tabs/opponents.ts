// Opponents tab: sortable, searchable list with the headline statistics; everything else in an expandable row.
import { exploitNotes, posterior, SIZE_BUCKETS } from '../../opponents/profile';
import { button, check, checkAll, confirmDialog, el, empty, nextSort, pager, searchBox, select, sortHeader, tag, toast } from '../ui/dom';
import type { Ctx } from '../ui/context';
import { ago, KEY_STATS, matches, OpponentRow, opponentRow, paginate, pct, shortId, sortRows, SortDir, STAT_GROUPS, statCell, STYLE_NAMES, tableLabel } from '../viewmodel';

type SortKey = string;
const state = { query: '', minHands: '0', sort: { key: 'hands' as SortKey, dir: 'desc' as SortDir }, page: 1, open: new Set<string>(), selected: new Set<string>() };
const PAGE = 25;
const CONF_TONE: Record<OpponentRow['confidence'], string> = { none: 'muted', low: 'warn', medium: 'accent', high: 'good' };
const CONF_TEXT: Record<OpponentRow['confidence'], string> = { none: 'too few hands', low: 'low confidence', medium: 'medium confidence', high: 'high confidence' };

function detail(r: OpponentRow, ctx: Ctx, rerender: () => void): HTMLElement {
  const p = r.profile;
  const notes = exploitNotes(p);
  const bars = el('div', { class: 'stylebars' }, ...STYLE_NAMES.map(([k, label]) => el('div', { class: 'stylebar' }, el('span', {}, label), el('div', { class: 'bar' }, el('i', { style: `width:${(100 * r.styles[k]).toFixed(1)}%` })), el('span', { class: 'num' }, pct(r.styles[k])))));
  const groups = el('div', { class: 'statgroups' });
  for (const g of STAT_GROUPS) {
    const t = el('table', { class: 'compact' }, el('thead', {}, el('tr', {}, el('th', {}, g.title), el('th', { class: 'num' }, 'Did / chances'), el('th', { class: 'num' }, 'Raw'), el('th', { class: 'num' }, 'Estimate'), el('th', { class: 'num' }, '90% interval'))));
    const body = el('tbody');
    for (const [k, label] of g.keys) {
      const q = posterior(p, k);
      body.append(el('tr', { class: q.d ? '' : 'faded' }, el('td', {}, label), el('td', { class: 'num' }, `${q.n} / ${q.d}`), el('td', { class: 'num' }, pct(q.raw)), el('td', { class: 'num' }, pct(q.mean)), el('td', { class: 'num' }, `${pct(q.lo)}–${pct(q.hi)}`)));
    }
    t.append(body);
    groups.append(el('div', { class: 'tablewrap' }, t));
  }
  const del = button('Delete this profile', async () => {
    const ok = await confirmDialog({
      title: `Delete the profile of ${p.name}?`, danger: true, confirmLabel: 'Delete profile',
      lines: [`All ${p.hands} hand(s) of statistics for this player are permanently deleted. The engine will treat the player as unknown again.`],
      keeps: ['Stored hands and recordings in which the player appears.'],
    });
    if (!ok) return;
    await ctx.storage.deleteProfiles([p.playerId]);
    await ctx.profilesDeleted([p.playerId]);
    state.open.delete(p.playerId); state.selected.delete(p.playerId);
    toast(`Profile of ${p.name} deleted.`);
    rerender();
  }, { tone: 'danger' });
  return el('div', { class: 'oppdetail' },
    el('div', { class: 'oppgrid' },
      el('div', {}, el('div', { class: 'label' }, 'Style probabilities'), bars,
        el('p', { class: 'muted small' }, `Based on ${p.stats.vpip.d} preflop opportunities. The label summarises the statistics; decisions use the statistics, never the label.`)),
      el('div', {}, el('div', { class: 'label' }, 'Patterns that clear the evidence threshold'),
        notes.length ? el('ul', { class: 'plain' }, ...notes.map((n) => el('li', {}, el('strong', {}, n.text), el('div', { class: 'muted small' }, n.evidence)))) : el('p', { class: 'muted' }, 'None yet.'),
        el('div', { class: 'label', style: 'margin-top:12px' }, 'Postflop bet sizes'),
        el('div', {}, ...SIZE_BUCKETS.map((b, i) => el('span', { class: 'pill' }, `${b}: ${p.betSizes[i]}${p.shownStrengthN[i] ? ` · shown strength ${pct(p.shownStrengthSum[i] / p.shownStrengthN[i])} (n=${p.shownStrengthN[i]})` : ''}`)))),
      el('div', {}, el('div', { class: 'label' }, 'Recent showdowns'),
        p.showdowns.length ? el('ul', { class: 'plain' }, ...p.showdowns.slice(-6).reverse().map((s) => el('li', {}, el('strong', {}, s.cards), ` ${s.line}`))) : el('p', { class: 'muted' }, 'None seen.'),
        el('div', { class: 'label', style: 'margin-top:12px' }, 'Identity'),
        el('div', { class: 'muted small mono', title: p.playerId }, r.scope ? `Name at table ${tableLabel(r.scope, ctx.nicknames())} (the site gave no player id)` : shortId(p.playerId, 10, 6)))),
    el('details', { class: 'more' }, el('summary', {}, 'All statistics with sample sizes and intervals'), groups),
    el('div', { class: 'rowactions' }, del));
}

export async function renderOpponents(root: HTMLElement, ctx: Ctx): Promise<void> {
  const profiles = await ctx.storage.allProfiles();
  const rerender = () => { void renderOpponents(root, ctx); };
  const hadFocus = document.activeElement?.id === 'opp-search';
  root.textContent = '';
  if (!profiles.length) { root.append(empty('No opponent profiles yet', 'Profiles appear after the first completed hand, or after importing a PokerNow log in Settings.')); return; }
  const all = profiles.map(opponentRow);
  const min = Number(state.minHands) || 0;
  const filtered = all.filter((r) => r.hands >= min && matches(state.query, r.name, r.id, r.style));
  const key = state.sort.key;
  const sorted = sortRows(filtered, (r) => (key === 'name' ? r.name : key === 'hands' ? r.hands : key === 'style' ? r.style : key === 'lastSeen' ? r.lastSeen : r.stats[key]?.d ? r.stats[key].mean : null), state.sort.dir);
  const page = paginate(sorted, state.page, PAGE);
  state.page = page.page;
  for (const id of [...state.selected]) if (!all.some((r) => r.id === id)) state.selected.delete(id);
  const onSort = (k: SortKey) => { state.sort = nextSort(state.sort, k, k === 'name' || k === 'style' ? 'asc' : 'desc'); state.page = 1; rerender(); };

  const head = el('tr', {}, el('th', { class: 'chk' }, checkAll(state.selected, page.rows.map((r) => r.id), rerender)),
    sortHeader('Player', 'name', state.sort, onSort), sortHeader('Hands', 'hands', state.sort, onSort, 'num'), sortHeader('Style', 'style', state.sort, onSort),
    ...KEY_STATS.map((s) => sortHeader(s.label, s.key, state.sort, onSort, 'num', s.title)), sortHeader('Last seen', 'lastSeen', state.sort, onSort, 'num'), el('th', { class: 'chev' }));
  const body = el('tbody');
  const now = Date.now();
  for (const r of page.rows) {
    const open = state.open.has(r.id);
    const row = el('tr', { class: `click${open ? ' open' : ''}`, 'data-id': r.id },
      el('td', { class: 'chk' }, check(state.selected, r.id, rerender, `Select ${r.name}`)),
      el('td', {}, el('div', { class: 'strong ellip', title: r.name }, r.name), el('div', { class: 'sub mono', title: r.id }, r.scope ? `table ${tableLabel(r.scope, ctx.nicknames())}` : shortId(r.id))),
      el('td', { class: 'num strong' }, String(r.hands)),
      el('td', {}, el('div', {}, r.styleKey === 'unclassified' ? el('span', { class: 'muted' }, 'Not enough hands') : `${r.style} ${pct(r.styleProb)}`), el('div', { class: 'sub' }, tag(CONF_TEXT[r.confidence], CONF_TONE[r.confidence], 'How far the number of hands supports any style label'))),
      ...KEY_STATS.map((s) => { const c = statCell(r.stats[s.key]); return el('td', { class: `num${c.observed ? '' : ' faded'}`, title: `${r.stats[s.key].n} of ${r.stats[s.key].d} opportunities` }, el('div', { class: 'strong' }, c.main), el('div', { class: 'sub' }, c.sub)); }),
      el('td', { class: 'num muted' }, ago(r.lastSeen, now)),
      el('td', { class: 'chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'));
    row.addEventListener('click', () => { if (open) state.open.delete(r.id); else state.open.add(r.id); rerender(); });
    body.append(row);
    if (open) body.append(el('tr', { class: 'detailrow' }, el('td', { colspan: String(5 + KEY_STATS.length + 1) }, detail(r, ctx, rerender))));
  }
  const delSel = button(`Delete selected (${state.selected.size})`, async () => {
    const ids = [...state.selected];
    const ok = await confirmDialog({
      title: `Delete ${ids.length} opponent profile(s)?`, danger: true, confirmLabel: `Delete ${ids.length} profile(s)`,
      lines: ['The statistics collected for these players are permanently deleted. The engine will treat them as unknown again.'],
      keeps: ['Stored hands and recordings in which they appear.'],
    });
    if (!ok) return;
    const rep = await ctx.storage.deleteProfiles(ids);
    await ctx.profilesDeleted(ids);
    state.selected.clear();
    toast(`${rep.profiles} profile(s) deleted.`);
    rerender();
  }, { tone: 'danger', disabled: state.selected.size === 0, id: 'opp-delete' });
  root.append(el('div', { class: 'toolbar' },
    searchBox(state.query, 'Search by name or id', (v) => { state.query = v; state.page = 1; rerender(); }, 'opp-search'),
    select(state.minHands, [['0', 'Any number of hands'], ['10', '10+ hands'], ['40', '40+ hands'], ['120', '120+ hands']], (v) => { state.minHands = v; state.page = 1; rerender(); }, 'Minimum hands'),
    el('span', { class: 'spacer' }), el('span', { class: 'muted' }, `${filtered.length} of ${all.length} players`), delSel));
  root.append(el('div', { class: 'card flush' },
    el('div', { class: 'tablewrap' }, el('table', { class: 'data', id: 'opp-table' }, el('thead', {}, head), body)),
    filtered.length ? null : empty('No player matches', 'Change the search or the hand filter.'),
    pager(page, (p) => { state.page = p; rerender(); }, 'players')));
  root.append(el('p', { class: 'muted small' }, 'Each figure is an estimate shrunk toward a typical player, with its 90% interval and the number of real opportunities (n) underneath. A dash means the situation was never observed. Deleting stored hands does not change these profiles.'));
  if (hadFocus) { const s = root.querySelector<HTMLInputElement>('#opp-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
}
