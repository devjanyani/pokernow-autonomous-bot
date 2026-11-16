// Pure view models behind the dashboard tabs and the popup.
import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../../src/bot/opponents/profile';
import { DecisionRecord, DEFAULT_SETTINGS, HandRecord, toHandRecord } from '../../src/bot/ext/records';
import { popupView } from '../../src/bot/ext/popup';
import type { TableSummary } from '../../src/bot/ext/storage';
import {
  chipImbalance, describePlan, filterHands, handDetail, handNumber, handRow, handStatus, handTotals, handWarnings, heroCommitted, matches, NO_HAND_FILTER,
  opponentRow, paginate, planTables, shortId, sortRows, statCell, tableEntries, tableLabel,
} from '../../src/bot/ext/viewmodel';
import { act, mk } from './helpers';

function played(id = 'tbl:h:7:123.5'): HandRecord {
  const h = mk(3, { id });           // seat 0 button, 1 small blind, 2 big blind; hero is seat 0
  act(h, 'raise', 60); act(h, 'fold'); act(h, 'fold');
  return toHandRecord({ hand: h, heroSeat: 0, heroCards: [0, 5], reveals: new Map(), observedToEnd: true, valid: true }, 'pglTableIdentifier01', 1000);
}
const rec = (eventCount: number, action: string, to: number | undefined, ts = 1): DecisionRecord => ({
  handId: 'x', tableId: 't', ts, eventCount, heroCards: [], board: [], pot: 0, execution: null,
  decision: { action, to, label: `${action} ${to ?? ''}`.trim(), candidates: [{ label: 'a', ev: 1.5, freq: 1 }], basis: ['why'], uncertainty: 'clear', equity: { equity: 0.61 } } as unknown as DecisionRecord['decision'],
});

describe('identifiers and list helpers', () => {
  it('shortens long ids, keeps short ones, and prefers a nickname', () => {
    expect(shortId('pglaSnQ1x9Zk3bV')).toBe('pglaSn…k3bV');
    expect(shortId('short-id')).toBe('short-id');
    expect(tableLabel('pglaSnQ1x9Zk3bV', new Map([['pglaSnQ1x9Zk3bV', 'Friday']]))).toBe('Friday');
    expect(tableLabel('imported-log', new Map())).toBe('Imported log');
    expect(handNumber('pglaSn:h:70:379221.6')).toBe('#70');
    expect(handNumber('live3')).toBe('live3');
  });
  it('sorts with missing values last in both directions, and is stable', () => {
    const rows = [{ n: 'b', v: 2 }, { n: 'x', v: null }, { n: 'a', v: 2 }, { n: 'c', v: 10 }];
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n)).toEqual(['b', 'a', 'c', 'x']);
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n)).toEqual(['c', 'b', 'a', 'x']);
    expect(sortRows(['t10', 't9', 'T1'], (r) => r, 'asc')).toEqual(['T1', 't9', 't10']);
  });
  it('pages within bounds', () => {
    const rows = Array.from({ length: 53 }, (_, i) => i);
    expect(paginate(rows, 3, 25)).toMatchObject({ page: 3, pages: 3, from: 51, to: 53, total: 53 });
    expect(paginate(rows, 99, 25).page).toBe(3);
    expect(paginate([], 4, 25)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
  });
  it('search needs every word, in any field', () => {
    expect(matches('ali fri', 'Alice', 'Friday game')).toBe(true);
    expect(matches('ali sat', 'Alice', 'Friday game')).toBe(false);
    expect(matches('  ', null)).toBe(true);
  });
});

describe('opponent rows', () => {
  it('keep sample size, interval and how far the hand count supports a style label', () => {
    const p = emptyProfile('name:pglTable:Bob', 'Bob', 1);
    p.hands = 50; p.stats.vpip = { n: 30, d: 50 }; p.stats.aggVsCall = { n: 4, d: 30 };
    const r = opponentRow(p);
    expect(r.scope).toBe('pglTable');
    expect(r.confidence).toBe('medium');
    expect(r.style).toBe('Loose-passive');
    expect(r.styleProb).toBeGreaterThan(0.5);
    const c = statCell(r.stats.vpip);
    expect(c.main).toBe('53%'); expect(c.sub).toMatch(/^\d+%–\d+% · n=50$/);
    expect(statCell(r.stats.threeBet)).toEqual({ main: '–', sub: 'no samples', observed: false });
    expect(opponentRow(emptyProfile('x')).confidence).toBe('none');
    expect(opponentRow(emptyProfile('x')).styleKey).toBe('unclassified');
  });
});

describe('hand rows', () => {
  it('a clean hand is verified and its result counts', () => {
    const h = played();
    expect(heroCommitted(h)).toBe(60); expect(chipImbalance(h)).toBe(0); expect(handWarnings(h)).toEqual([]);
    const r = handRow(h, new Map());
    expect(r).toMatchObject({ number: '#7', table: 'pglTab…er01', players: 3, netBB: 1.5, verified: true, heroPosition: 'BTN' });
    expect(r.status.kind).toBe('verified');
  });
  it('a result that the betting cannot explain is shown as unverified and never summed', () => {
    const h = played();
    h.heroNet = -5000; h.seats[0].endStack = h.seats[0].startStack - 5000;
    expect(handStatus(h).kind).toBe('unverified');
    const w = handWarnings(h);
    expect(w.some((x) => /do not add up to zero/.test(x))).toBe(true);
    expect(w.some((x) => /fell by 5000 but the recorded actions put only 60/.test(x))).toBe(true);
    const rows = [handRow(h, new Map()), handRow(played('t:h:8:1'), new Map())];
    expect(rows[0]).toMatchObject({ verified: false, netBB: -250 });
    expect(handTotals(rows)).toEqual({ hands: 2, verified: 1, netBB: 1.5, unverifiedWithResult: 1, noResult: 0 });
  });
  it('invalid and unfinished hands say so', () => {
    const a = played(); a.valid = false;
    expect(handStatus(a).kind).toBe('invalid');
    const b = played(); b.observedToEnd = false; b.valid = false; b.heroNet = null;
    expect(handStatus(b).kind).toBe('ending-not-observed');
    expect(handWarnings(b)[0]).toMatch(/end of this hand was not observed/);
    expect(handTotals([handRow(a, new Map()), handRow(b, new Map())])).toMatchObject({ verified: 0, netBB: 0, unverifiedWithResult: 1, noResult: 1 });
  });
  it('filters by table, status, involvement and text', () => {
    const a = handRow(played('a:h:1:1'), new Map());
    const bRec = played('b:h:2:2'); bRec.tableId = 'other'; bRec.valid = false;
    const b = handRow(bRec, new Map());
    expect(filterHands([a, b], NO_HAND_FILTER).length).toBe(2);
    expect(filterHands([a, b], { ...NO_HAND_FILTER, table: 'other' })).toEqual([b]);
    expect(filterHands([a, b], { ...NO_HAND_FILTER, status: 'problems' })).toEqual([b]);
    expect(filterHands([a, b], { ...NO_HAND_FILTER, status: 'verified', hero: 'won' })).toEqual([a]);
    expect(filterHands([a, b], { ...NO_HAND_FILTER, query: '2h 3d' }).length).toBe(2);
    expect(filterHands([a, b], { ...NO_HAND_FILTER, query: 'zz' }).length).toBe(0);
  });
});

describe('hand detail', () => {
  it('groups actions by street and compares what was played with what was recommended', () => {
    const h = played();
    const d = handDetail(h, [rec(2, 'raise', 50, 1), rec(2, 'raise', 60, 2)]); // recomputed: the later one counts
    expect(d.streets.map((s) => s.street)).toEqual(['preflop']);
    const hero = d.streets[0].actions.find((a) => a.isHero && a.kind === 'raise')!;
    expect(hero.text).toBe('raises to 60');
    expect(hero.rec).toMatchObject({ match: 'followed', to: 60, equity: 0.61 });
    expect(d).toMatchObject({ heroDecisions: 1, withRecommendation: 1, followed: 1 });
    expect(handDetail(h, [rec(2, 'raise', 45)]).streets[0].actions[2].rec!.match).toBe('same-action-other-size');
    expect(handDetail(h, [rec(2, 'fold', undefined)]).streets[0].actions[2].rec!.match).toBe('different');
    expect(handDetail(h, []).withRecommendation).toBe(0);
    expect(d.players.find((p) => p.isHero)).toMatchObject({ net: 30, position: 'BTN' });
  });
  it('shows the board cards of each street, including streets with no betting', () => {
    const h = played();
    h.board = ['Ah', 'Kd', '2c', '7s', '9h'];
    h.events.push({ seq: 5, seat: 0, street: 'flop', kind: 'check', amount: 0, to: 0, allIn: false, potBefore: 90, inferred: true });
    const d = handDetail(h, []);
    expect(d.streets.map((s) => [s.street, s.cards.join(' '), s.actions.length])).toEqual([['preflop', '', 5], ['flop', 'Ah Kd 2c', 1], ['turn', '7s', 0], ['river', '9h', 0]]);
    expect(d.streets[1].potBefore).toBe(90);
    expect(d.streets[1].actions[0].deduced).toBe(true);
    expect(d.warnings.some((w) => /deduced from the rules/.test(w))).toBe(true);
  });
});

describe('table list', () => {
  const sum = (tableId: string, lastSeen: number, hands = 0, frames = 0): TableSummary => ({ tableId, nickname: '', firstSeen: lastSeen, lastSeen, hands, decisions: 0, frames, diagnostics: 0 });
  const DAY = 86400000, now = 100 * DAY;
  const entries = () => tableEntries([sum('old', now - 30 * DAY, 10, 50), sum('recent', now - DAY, 3, 9), sum('open', now, 1, 4)], { authorizedTables: ['old', 'open', 'never-seen'] }, 'open', now);

  it('merges stored history, authorisations and the open table; the open table comes first and is never stale', () => {
    const e = entries();
    expect(e.map((t) => [t.tableId, t.authorized, t.active, t.stale])).toEqual([['open', true, true, false], ['recent', false, false, false], ['old', true, false, true], ['never-seen', true, false, true]]);
  });
  it('a bulk plan never includes the open table and separates revoking from deleting', () => {
    const e = entries();
    const all = planTables(e, { revoke: true, purge: true });
    expect(all.tables.map((t) => t.tableId)).toEqual(['recent', 'old', 'never-seen']);
    expect(all.revoke).toEqual(['old', 'never-seen']);
    expect(all.purge).toEqual(['recent', 'old']);
    expect([all.hands, all.frames]).toEqual([13, 59]);
    const revokeOnly = planTables(e, { revoke: true, purge: false });
    expect(revokeOnly.purge).toEqual([]); expect(revokeOnly.hands).toBe(0);
    expect(describePlan(revokeOnly)).toEqual([expect.stringMatching(/^Revoke the authorisation of 2 table/)]);
    const purgeOnly = planTables(e, { revoke: false, purge: true });
    expect(purgeOnly.revoke).toEqual([]);
    expect(describePlan(purgeOnly)[0]).toMatch(/Permanently delete the stored history of 2 table\(s\): 13 hand\(s\), 0 recommendation\(s\), 59 recorded frame\(s\)/);
    expect(describePlan(planTables([e[0]], { revoke: true, purge: true }))).toEqual(['Nothing to do for the selected tables.']);
  });
});

describe('popup', () => {
  const many = Array.from({ length: 40 }, (_, i) => `pglTable${i}xxxxxxxx`);
  it('shows this table and a count of the others, never the list of ids', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'autonomous' as const, authorizationConfirmed: true, authorizedTables: many };
    const v = popupView(s, many[3], '');
    expect(v).toMatchObject({ authorised: true, authTag: 'authorised', others: '39 other tables are authorised.', tone: 'warn', state: 'ACTING automatically on this table.' });
    expect(JSON.stringify(v)).not.toContain(many[7]);
    expect(popupView(s, 'pglNotAuthorised000', 'Home game')).toMatchObject({ tableName: 'Home game', tableId: 'pglNotAuthorised000', authorised: false, others: '40 other tables are authorised.' });
    expect(popupView(s, null, '')).toMatchObject({ tableName: 'Not on a PokerNow table', authTag: '–' });
  });
  it('the emergency stop and recommend-only states are stated plainly', () => {
    expect(popupView({ ...DEFAULT_SETTINGS, estop: true }, 't', '')).toMatchObject({ tone: 'bad', state: 'Emergency stop is ON: nothing will be clicked.' });
    expect(popupView(DEFAULT_SETTINGS, 't', '')).toMatchObject({ tone: 'good', state: 'Recommending only. Nothing is clicked.', others: 'No other table is authorised.' });
  });
});
