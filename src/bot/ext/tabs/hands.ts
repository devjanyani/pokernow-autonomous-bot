// Hand review tab: filterable, sortable, paged list on the left; the selected hand on the right.
import { buildBundle } from '../../diag/recorder';
import type { HandRecord } from '../records';
import { button, cardRow, check, checkAll, confirmDialog, download, el, empty, nextSort, pager, playingCard, searchBox, select, sortHeader, stamp, tag, toast } from '../ui/dom';
import type { Ctx } from '../ui/context';
import { chips } from '../view';
import { filterHands, HandFilter, handDetail, HandRow, handRow, handTotals, NO_HAND_FILTER, paginate, pct, shortId, sortRows, SortDir, tableLabel } from '../viewmodel';

type SortKey = 'ts' | 'table' | 'players' | 'net' | 'status';
const state = { filter: { ...NO_HAND_FILTER } as HandFilter, sort: { key: 'ts' as SortKey, dir: 'desc' as SortDir }, page: 1, size: 25, selected: new Set<string>(), current: null as string | null };
const STATUS_RANK = { verified: 0, unverified: 1, 'ending-not-observed': 2, invalid: 3 };
const signed = (x: number, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`;

function resultCell(r: HandRow): HTMLElement {
  if (r.netBB === null) return el('td', { class: 'num muted', title: 'No result is known for this hand.' }, '–');
  if (!r.verified) return el('td', { class: 'num muted', title: 'Recorded stack change, NOT verified. It is not counted in any total.' }, `${signed(r.netBB)} ?`);
  return el('td', { class: `num strong ${r.netBB > 0 ? 'good' : r.netBB < 0 ? 'bad' : ''}` }, signed(r.netBB));
}

async function detailPanel(h: HandRecord, ctx: Ctx, rerender: () => void): Promise<HTMLElement> {
  const decisions = await ctx.storage.decisionsForHand(h.handId);
  const frames = await ctx.storage.framesForHand(h.handId);
  const d = handDetail(h, decisions);
  const row = handRow(h, ctx.nicknames());
  const bb = h.bigBlind || 1;
  const head = el('div', { class: 'handhead' },
    el('div', {}, el('div', { class: 'handtitle' }, `Hand ${row.number}`, tag(d.status.label, d.status.tone, d.status.detail)),
      el('div', { class: 'muted small' }, `${row.table} · ${new Date(h.ts).toLocaleString()} · blinds ${chips(h.smallBlind)}/${chips(h.bigBlind)}${h.ante ? ` · ante ${chips(h.ante)}` : ''}`)),
    el('div', { class: 'handcards' }, el('div', {}, el('div', { class: 'label' }, 'Hero'), el('div', { class: 'cards' }, ...(h.heroCards ?? [null, null]).map((c) => playingCard(c, 'sm', !h.heroCards)))),
      el('div', {}, el('div', { class: 'label' }, 'Board'), el('div', { class: 'cards' }, ...Array.from({ length: 5 }, (_, i) => playingCard(h.board[i] ?? null, 'sm', true))))));
  const result = row.netBB === null ? el('div', { class: 'resultbox muted' }, 'No result known')
    : el('div', { class: `resultbox ${row.verified ? (row.netBB > 0 ? 'good' : row.netBB < 0 ? 'bad' : '') : 'muted'}` },
      el('div', { class: 'label' }, row.verified ? 'Hero result (verified)' : 'Hero stack change (NOT verified)'),
      el('div', { class: 'resultnum' }, `${signed(h.heroNet as number, 2).replace(/\.00$/, '')} chips · ${signed(row.netBB)} bb`));
  const warn = d.warnings.length ? el('div', { class: 'warnbox', id: 'hand-warnings' }, el('div', { class: 'label' }, 'Reconstruction warnings'), el('ul', {}, ...d.warnings.map((w) => el('li', {}, w)))) : null;

  const pt = el('table', { class: 'compact' }, el('thead', {}, el('tr', {}, el('th', {}, 'Pos'), el('th', {}, 'Player'), el('th', { class: 'num' }, 'Start'), el('th', { class: 'num' }, 'End'), el('th', { class: 'num' }, 'Change'), el('th', {}, 'Cards'))));
  const pb = el('tbody');
  for (const p of d.players) {
    pb.append(el('tr', { class: p.isHero ? 'herorow' : '' }, el('td', {}, p.position ? el('span', { class: 'posbadge sm' }, p.position) : ''), el('td', { class: 'ellip', title: p.name }, p.name, p.isHero ? tag('you', 'accent') : null, p.folded ? tag('folded', 'muted') : null),
      el('td', { class: 'num' }, chips(p.startStack)), el('td', { class: 'num' }, chips(p.endStack)),
      el('td', { class: `num ${d.status.kind !== 'verified' ? 'muted' : p.net > 0 ? 'good' : p.net < 0 ? 'bad' : 'muted'}` }, p.net === 0 ? '0' : signed(p.net, 2).replace(/\.00$/, '')),
      el('td', {}, p.isHero ? cardRow(h.heroCards) : p.shown ? cardRow(p.shown) : el('span', { class: 'muted' }, 'not shown'))));
  }
  pt.append(pb);

  const streets = el('div', { class: 'streets' });
  for (const s of d.streets) {
    const list = el('ol', { class: 'actions' });
    for (const a of s.actions) {
      const li = el('li', { class: `${a.isHero ? 'hero' : ''}${a.kind === 'fold' ? ' fold' : ''}` },
        el('span', { class: 'who' }, a.position ? el('span', { class: 'posbadge sm' }, a.position) : null, el('span', { class: 'ellip', title: a.name }, a.name)),
        el('span', { class: 'what' }, a.text, a.allIn ? tag('all-in', 'warn') : null, a.unconfirmed ? tag('deduced, unconfirmed', 'bad', 'Not displayed by the table and never confirmed') : a.deduced ? tag('deduced', 'warn', 'Not displayed by the table: it follows from the rules') : null));
      if (a.rec) {
        const m = a.rec.match;
        const verdict = m === 'followed' ? tag('played as recommended', 'good') : m === 'same-action-other-size' ? tag('same action, different size', 'warn') : tag('played differently', 'bad');
        li.append(el('div', { class: `rec ${m}` },
          el('div', {}, el('span', { class: 'label inline' }, 'Recommended'), el('strong', {}, a.rec.label), verdict, a.rec.execution ? tag(`executor: ${a.rec.execution}`, 'muted') : null),
          el('details', { class: 'more' }, el('summary', {}, `Options and reasoning${a.rec.equity !== null ? ` · equity ${pct(a.rec.equity, 1)}` : ''}`),
            el('div', { class: 'muted small' }, a.rec.candidates.map((c) => `${c.label}${c.ev !== null ? ` EV ${c.ev.toFixed(1)}` : ''} · ${pct(c.freq)}`).join('   |   ')),
            el('ul', { class: 'why small' }, ...a.rec.basis.map((b) => el('li', {}, b))), a.rec.uncertainty ? el('div', { class: 'muted small' }, a.rec.uncertainty) : null)));
      } else if (a.isHero && !a.kind.startsWith('post')) li.append(el('div', { class: 'rec none muted small' }, 'No recommendation was stored for this decision.'));
      list.append(li);
    }
    streets.append(el('section', { class: 'street' },
      el('div', { class: 'streethead' }, el('span', { class: 'streetname' }, s.street), s.cards.length ? el('span', { class: 'cards tight' }, ...s.cards.map((c) => playingCard(c, 'sm'))) : null,
        el('span', { class: 'spacer' }), s.potBefore !== null ? el('span', { class: 'muted' }, `pot ${chips(s.potBefore)} (${(s.potBefore / bb).toFixed(1)} bb)`) : null),
      s.actions.length ? list : el('div', { class: 'muted small' }, 'No betting on this street.')));
  }
  const recSummary = d.heroDecisions ? `${d.heroDecisions} Hero decision(s) · ${d.withRecommendation} with a stored recommendation · ${d.followed} played as recommended` : 'Hero made no decision in this hand.';

  const del = button('Delete this hand', async () => {
    const ok = await confirmDialog({
      title: `Delete hand ${row.number}?`, danger: true, confirmLabel: 'Delete hand',
      lines: [`The hand, its ${decisions.length} stored recommendation(s) and its ${frames.length} recorded frame(s) are permanently deleted.`],
      keeps: ['Opponent profiles: they keep what this hand contributed to their statistics.', 'Every other hand.'],
    });
    if (!ok) return;
    await ctx.storage.deleteHands([h.handId]);
    state.current = null; state.selected.delete(h.handId);
    toast(`Hand ${row.number} deleted.`);
    rerender();
  }, { tone: 'danger', id: 'hand-delete' });
  const delRec = button('Delete recording only', async () => {
    const ok = await confirmDialog({ title: `Delete the recording of hand ${row.number}?`, danger: true, confirmLabel: 'Delete recording', lines: [`${frames.length} recorded frame(s) are permanently deleted.`], keeps: ['The hand summary, its recommendations and all profiles.'] });
    if (!ok) return;
    await ctx.storage.deleteRecordings([h.handId]);
    toast('Recording deleted.');
    rerender();
  }, { disabled: frames.length === 0 });
  const exp = button('Export recording', async () => {
    const b = buildBundle(frames.sort((x, y) => x.wall - y.wall), { hands: 'all', anonymise: false, extensionVersion: ctx.version, userAgent: navigator.userAgent, handRecords: [h], decisions });
    download(`poker-bot-hand-${stamp()}.json`, JSON.stringify(b));
  }, { disabled: frames.length === 0, title: 'A debug bundle with only this hand. Contains player names and the table id.' });
  return el('div', { class: 'card handdetail', id: 'hand-detail' }, head, result, warn,
    el('div', { class: 'label', style: 'margin-top:14px' }, 'Players'), el('div', { class: 'tablewrap' }, pt),
    el('div', { class: 'label', style: 'margin-top:14px' }, 'Action'), el('div', { class: 'muted small' }, recSummary), streets,
    el('div', { class: 'rowactions' }, exp, delRec, del, el('span', { class: 'spacer' }), el('span', { class: 'muted small mono', title: h.handId }, shortId(h.handId, 10, 8))));
}

let token = 0;
export async function renderHands(root: HTMLElement, ctx: Ctx): Promise<void> {
  const mine = ++token;
  const hands = await ctx.storage.recentHands(5000);
  if (mine !== token) return;
  const rerender = () => { void renderHands(root, ctx); };
  const hadFocus = document.activeElement?.id === 'hand-search';
  const scroll = root.querySelector('.handlist .tablewrap')?.scrollTop ?? 0;
  root.textContent = '';
  if (!hands.length) { root.append(empty('No hands stored yet', 'Completed hands are stored locally as they are observed.')); return; }
  const nick = ctx.nicknames();
  const all = hands.map((h) => handRow(h, nick));
  const filtered = filterHands(all, state.filter);
  const k = state.sort.key;
  const sorted = sortRows(filtered, (r) => (k === 'ts' ? r.ts : k === 'table' ? r.table : k === 'players' ? r.players : k === 'net' ? r.netBB : STATUS_RANK[r.status.kind]), state.sort.dir);
  const page = paginate(sorted, state.page, state.size);
  state.page = page.page;
  for (const id of [...state.selected]) if (!all.some((r) => r.id === id)) state.selected.delete(id);
  if (state.current && !all.some((r) => r.id === state.current)) state.current = null;
  const onSort = (key: SortKey) => { state.sort = nextSort(state.sort, key, key === 'table' ? 'asc' : 'desc'); state.page = 1; rerender(); };
  const setFilter = (patch: Partial<HandFilter>) => { state.filter = { ...state.filter, ...patch }; state.page = 1; rerender(); };

  const tables = [...new Set(all.map((r) => r.tableId))];
  const totals = handTotals(filtered);
  root.append(el('div', { class: 'statrow' },
    el('div', { class: 'stat' }, el('div', { class: 'label' }, 'Hands shown'), el('div', { class: 'statnum' }, String(totals.hands)), el('div', { class: 'sub' }, `of ${all.length} stored`)),
    el('div', { class: 'stat' }, el('div', { class: 'label' }, 'Hero result, verified hands'), el('div', { class: `statnum ${totals.netBB > 0 ? 'good' : totals.netBB < 0 ? 'bad' : ''}`, id: 'hands-total' }, `${signed(totals.netBB)} bb`), el('div', { class: 'sub' }, `over ${totals.verified} verified hand(s)`)),
    el('div', { class: 'stat' }, el('div', { class: 'label' }, 'Not counted'), el('div', { class: 'statnum' }, String(totals.unverifiedWithResult + totals.noResult)), el('div', { class: 'sub' }, `${totals.unverifiedWithResult} unverified result(s), ${totals.noResult} with no result`))));

  root.append(el('div', { class: 'toolbar' },
    searchBox(state.filter.query, 'Search player, card (e.g. Ah) or table', (v) => setFilter({ query: v }), 'hand-search'),
    select(state.filter.table, [['all', 'All tables'], ...tables.map((t) => [t, tableLabel(t, nick)] as [string, string])], (v) => setFilter({ table: v }), 'Table'),
    select(state.filter.status, [['all', 'Any status'], ['verified', 'Verified'], ['problems', 'Any problem'], ['unverified', 'Result unverified'], ['ending-not-observed', 'Ending not observed'], ['invalid', 'Reconstruction invalid']], (v) => setFilter({ status: v }), 'Status'),
    select(state.filter.hero, [['all', 'All hands'], ['played', 'Hero played'], ['won', 'Hero won'], ['lost', 'Hero lost']], (v) => setFilter({ hero: v }), 'Hero involvement'),
    el('span', { class: 'spacer' }),
    button(`Delete selected (${state.selected.size})`, async () => {
      const ids = [...state.selected];
      const ok = await confirmDialog({
        title: `Delete ${ids.length} hand(s)?`, danger: true, confirmLabel: `Delete ${ids.length} hand(s)`,
        lines: ['The selected hands, their stored recommendations and their recorded frames are permanently deleted.'],
        keeps: ['Opponent profiles: they keep what these hands contributed to their statistics.', 'Hands that are not selected.'],
      });
      if (!ok) return;
      const rep = await ctx.storage.deleteHands(ids);
      state.selected.clear();
      toast(`${rep.hands} hand(s), ${rep.decisions} recommendation(s) and ${rep.frames} frame(s) deleted.`);
      rerender();
    }, { tone: 'danger', disabled: state.selected.size === 0, id: 'hands-delete' })));

  const head = el('tr', {}, el('th', { class: 'chk' }, checkAll(state.selected, page.rows.map((r) => r.id), rerender)),
    sortHeader('Time', 'ts', state.sort, onSort), sortHeader('Table', 'table', state.sort, onSort), el('th', {}, 'Hand'), el('th', {}, 'Hero'), el('th', {}, 'Board'),
    sortHeader('Players', 'players', state.sort, onSort, 'num'), sortHeader('Result (bb)', 'net', state.sort, onSort, 'num'), sortHeader('Status', 'status', state.sort, onSort));
  const body = el('tbody');
  for (const r of page.rows) {
    const t = new Date(r.ts);
    const tr = el('tr', { class: `click${state.current === r.id ? ' sel' : ''}`, 'data-id': r.id },
      el('td', { class: 'chk' }, check(state.selected, r.id, rerender, `Select hand ${r.number}`)),
      el('td', { class: 'nowrap' }, el('div', {}, t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), el('div', { class: 'sub' }, t.toLocaleDateString([], { month: 'short', day: 'numeric' }))),
      el('td', { class: 'ellip', title: r.tableId }, r.table),
      el('td', { class: 'nowrap' }, r.number, r.heroPosition ? el('span', { class: 'posbadge sm', style: 'margin-left:6px' }, r.heroPosition) : null),
      el('td', {}, cardRow(r.h.heroCards)), el('td', {}, cardRow(r.h.board)),
      el('td', { class: 'num' }, String(r.players)), resultCell(r),
      el('td', {}, tag(r.status.label, r.status.tone, r.status.detail)));
    tr.addEventListener('click', () => { state.current = state.current === r.id ? null : r.id; rerender(); });
    body.append(tr);
  }
  const sizeSel = select(String(state.size), [['25', '25 per page'], ['50', '50 per page'], ['100', '100 per page']], (v) => { state.size = Number(v); state.page = 1; rerender(); }, 'Rows per page');
  const listCard = el('div', { class: 'card flush handlist' },
    el('div', { class: 'tablewrap tall' }, el('table', { class: 'data', id: 'hands-table' }, el('thead', {}, head), body)),
    filtered.length ? null : empty('No hand matches', 'Change the search or the filters.'),
    el('div', { class: 'pagerrow' }, pager(page, (p) => { state.page = p; rerender(); }, 'hands'), sizeSel));
  const current = state.current ? hands.find((h) => h.handId === state.current) : undefined;
  const side = current ? await detailPanel(current, ctx, rerender) : el('div', { class: 'card handdetail placeholder' }, empty('Select a hand', 'Click a row to see the cards, every action by street, what was recommended and what was played, and any reconstruction warnings.'));
  if (mine !== token) return;
  root.append(el('div', { class: 'split' }, listCard, side));
  const wrap = root.querySelector('.handlist .tablewrap'); if (wrap) wrap.scrollTop = scroll;
  if (hadFocus) { const s = root.querySelector<HTMLInputElement>('#hand-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
}
