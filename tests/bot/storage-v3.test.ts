// Database version 3: upgrade from version 2, per-table deletion, hand deletion, tombstones, and that nothing
// deleted comes back after the database is reopened or the table keeps recording.
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { DebugFrame } from '../../src/bot/diag/recorder';
import { emptyProfile, PlayerProfile } from '../../src/bot/opponents/profile';
import { DecisionRecord, DEFAULT_SETTINGS, HandRecord, patchSettings, sanitizeSettings, toHandRecord } from '../../src/bot/ext/records';
import { BotStorage, DB_NAME, DB_VERSION } from '../../src/bot/ext/storage';
import { act, mk } from './helpers';

function hand(id: string, tableId: string, ts: number): HandRecord {
  const h = mk(3, { id });
  act(h, 'raise', 60); act(h, 'fold'); act(h, 'fold');
  return toHandRecord({ hand: h, heroSeat: 0, heroCards: [0, 5], reveals: new Map(), observedToEnd: true, valid: true }, tableId, ts);
}
const frame = (session: string, n: number, tableId: string, handKey: string | null, wall: number): DebugFrame =>
  ({ session, n, ts: n, wall, handKey, obs: { ts: n, tableId, seats: [] }, tracker: {}, events: [], decision: {} } as unknown as DebugFrame);
const decision = (handId: string, tableId: string, ts: number, eventCount = 2): DecisionRecord =>
  ({ handId, tableId, ts, eventCount, heroCards: [], board: [], pot: 0, decision: { action: 'raise', label: 'Raise' } as DecisionRecord['decision'], execution: null });
function profile(id: string, hands: number, firstSeen: number): PlayerProfile {
  const p = emptyProfile(id, id, firstSeen); p.hands = hands; p.lastSeen = firstSeen + 1; p.stats.vpip = { n: hands, d: hands }; return p;
}

/** Two tables, three hands, with decisions, frames, log lines and profiles. */
async function seed(st: BotStorage): Promise<void> {
  await st.saveHand(hand('A:h:1:10', 'A', 1000), [profile('p1', 1, 900), profile('p2', 1, 900)]);
  await st.saveHand(hand('A:h:2:20', 'A', 2000), [profile('p1', 2, 900)]);
  await st.saveHand(hand('B:h:1:10', 'B', 3000), [profile('p3', 1, 2900)]);
  for (const [h, t, ts] of [['A:h:1:10', 'A', 1001], ['A:h:1:10', 'A', 1002], ['A:h:2:20', 'A', 2001], ['B:h:1:10', 'B', 3001]] as const) await st.saveDecision(decision(h, t, ts));
  await st.saveFrames([frame('sA', 0, 'A', null, 990), frame('sA', 1, 'A', 'A:h:1:10', 1000), frame('sA', 2, 'A', 'A:h:1:10', 1005), frame('sA', 3, 'A', 'A:h:2:20', 2000)]);
  await st.saveFrames([frame('sB', 0, 'B', 'B:h:1:10', 3000), frame('sB', 1, 'B', 'B:h:1:10', 3050)]);
  await st.saveDiagnostic({ ts: 1500, level: 'warn', source: 'controller', message: 'at A', tableId: 'A' });
  await st.saveDiagnostic({ ts: 3500, level: 'warn', source: 'controller', message: 'at B', tableId: 'B' });
  await st.saveDiagnostic({ ts: 3600, level: 'info', source: 'content', message: 'no table' });
}
async function counts(st: BotStorage) {
  const hands = await st.recentHands(100), decisions = await st.recentDecisions(100), frames = await st.recentFrames(100), log = await st.recentDiagnostics(100);
  const ids = new Set(hands.map((h) => h.handId));
  return {
    hands: hands.map((h) => h.handId).sort(), decisions: decisions.length, frames: frames.length, log: log.map((d) => d.message).sort(),
    orphanDecisions: decisions.filter((d) => !ids.has(d.handId)).length, orphanFrames: frames.filter((f) => f.handKey !== null && !ids.has(f.handKey)).length,
    profiles: (await st.allProfiles()).map((p) => `${p.playerId}:${p.hands}`).sort(),
  };
}

describe('upgrade from database version 2', () => {
  /** Build the database exactly as version 2 created it, with rows as 0.6.x wrote them. */
  async function v2(idb: IDBFactory): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('profiles', { keyPath: 'playerId' });
        d.createObjectStore('hands', { keyPath: 'handId' }).createIndex('ts', 'ts');
        const dec = d.createObjectStore('decisions', { autoIncrement: true }); dec.createIndex('handId', 'handId'); dec.createIndex('ts', 'ts');
        d.createObjectStore('diagnostics', { autoIncrement: true }).createIndex('ts', 'ts');
        const fr = d.createObjectStore('frames', { autoIncrement: true }); fr.createIndex('ts', 'wall'); fr.createIndex('handKey', 'handKey');
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['profiles', 'hands', 'decisions', 'diagnostics', 'frames', 'meta'], 'readwrite');
    tx.objectStore('profiles').put(profile('p1', 7, 500));
    tx.objectStore('hands').put(hand('A:h:1:10', 'A', 1000)); tx.objectStore('hands').put(hand('A:h:2:20', 'A', 2500)); tx.objectStore('hands').put(hand('B:h:1:10', 'B', 3000));
    tx.objectStore('decisions').add(decision('A:h:1:10', 'A', 1001)); tx.objectStore('decisions').add(decision('C:h:9:9', 'C', 4000));
    tx.objectStore('diagnostics').add({ ts: 1, level: 'info', source: 'content', message: 'old line' });
    for (const f of [frame('sA', 0, 'A', 'A:h:1:10', 990), frame('sA', 1, 'A', 'A:h:1:10', 1010), frame('sB', 0, 'B', 'B:h:1:10', 3000), frame('sU', 0, 'unknown', null, 5000)]) tx.objectStore('frames').add(f);
    tx.objectStore('meta').put({ key: 'framesPruned', value: 12 });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }

  it('keeps every stored row, adds the indexes, and fills the table and session registries from what is stored', async () => {
    const idb = new IDBFactory();
    await v2(idb);
    const st = new BotStorage(idb);
    expect(DB_VERSION).toBe(3);
    const c = await counts(st);
    expect(c.hands).toEqual(['A:h:1:10', 'A:h:2:20', 'B:h:1:10']);
    expect(c.decisions).toBe(2); expect(c.frames).toBe(4); expect(c.log).toEqual(['old line']); expect(c.profiles).toEqual(['p1:7']);
    expect(await st.framesPruned()).toBe(12);
    const t = await st.tableSummaries();
    expect(t.map((x) => [x.tableId, x.hands, x.decisions, x.frames, x.firstSeen, x.lastSeen])).toEqual([
      ['C', 0, 1, 0, 4000, 4000], ['B', 1, 0, 1, 3000, 3000], ['A', 2, 1, 2, 990, 2500],
    ]);
    const s = await st.sessionSummaries();
    expect(s.map((x) => [x.session, x.tableId, x.frames, x.hands, x.firstWall, x.lastWall])).toEqual([['sU', '', 1, 0, 5000, 5000], ['sB', 'B', 1, 1, 3000, 3000], ['sA', 'A', 2, 1, 990, 1010]]);
  });

  it('is idempotent: reopening does not rewrite the registries, and old rows can be deleted by table', async () => {
    const idb = new IDBFactory();
    await v2(idb);
    await new BotStorage(idb).setNickname('A', 'Friday game');
    const st = new BotStorage(idb);
    expect((await st.tableSummaries()).find((x) => x.tableId === 'A')!.nickname).toBe('Friday game');
    const rep = await st.deleteTables(['A']);
    expect(rep).toMatchObject({ hands: 2, decisions: 1, frames: 2, tables: 1, sessions: 1 });
    expect((await counts(new BotStorage(idb))).hands).toEqual(['B:h:1:10']);
  });

  it('a new installation gets the same schema with empty registries', async () => {
    const st = new BotStorage(new IDBFactory());
    expect(await st.tableSummaries()).toEqual([]);
    expect(await st.sessionSummaries()).toEqual([]);
  });
});

describe('deleting hands', () => {
  it('removes the hand with its decisions and frames, and nothing else', async () => {
    const idb = new IDBFactory();
    const st = new BotStorage(idb);
    await seed(st);
    const before = await counts(st);
    const rep = await st.deleteHands(['A:h:1:10', 'A:h:1:10', 'missing']);
    expect(rep).toMatchObject({ hands: 1, decisions: 2, frames: 2, sessions: 0 });
    const after = await counts(new BotStorage(idb)); // reopened: the deletion is persistent
    expect(after.hands).toEqual(['A:h:2:20', 'B:h:1:10']);
    expect(after.decisions).toBe(before.decisions - 2);
    expect(after.frames).toBe(before.frames - 2);
    expect(after.orphanDecisions).toBe(0); expect(after.orphanFrames).toBe(0);
    expect(after.log).toEqual(before.log);
  });

  it('does not change opponent profiles: they keep what the hand contributed', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    const before = (await counts(st)).profiles;
    await st.deleteHands(['A:h:1:10', 'A:h:2:20', 'B:h:1:10']);
    expect((await counts(st)).profiles).toEqual(before);
    expect(before).toEqual(['p1:2', 'p2:1', 'p3:1']);
  });

  it('drops a recording session once its last frame is gone', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    expect((await st.deleteHands(['B:h:1:10'])).sessions).toBe(1);
    expect((await st.sessionSummaries()).map((s) => s.session)).toEqual(['sA']);
  });
});

describe('deleting tables', () => {
  it('removes everything stored for the selected table and only that table', async () => {
    const idb = new IDBFactory();
    const st = new BotStorage(idb);
    await seed(st);
    const rep = await st.deleteTables(['A']);
    expect(rep).toMatchObject({ hands: 2, decisions: 3, frames: 4, diagnostics: 1, sessions: 1, tables: 1, profiles: 0 });
    const after = await counts(new BotStorage(idb));
    expect(after.hands).toEqual(['B:h:1:10']);
    expect(after).toMatchObject({ decisions: 1, frames: 2, orphanDecisions: 0, orphanFrames: 0, log: ['at B', 'no table'], profiles: ['p1:2', 'p2:1', 'p3:1'] });
    expect((await st.tableSummaries()).map((t) => t.tableId)).toEqual(['B']);
  });

  it('never touches the protected (open) table, even when it is in the list', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    const rep = await st.deleteTables(['A', 'B'], { protect: 'B' });
    expect(rep.hands).toBe(2);
    expect((await counts(st)).hands).toEqual(['B:h:1:10']);
    expect(await st.deleteTables(['B'], { protect: 'B' })).toMatchObject({ hands: 0, frames: 0, tables: 0 });
  });

  it('keeps the nickname of a table that stays authorised, and ignores ids that are not tables', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    await st.setNickname('A', '  Home\u0007 game  ');
    await st.deleteTables(['A', '', 'unknown'], { keepRows: ['A'] });
    const a = (await st.tableSummaries()).find((t) => t.tableId === 'A')!;
    expect(a).toMatchObject({ nickname: 'Home  game', hands: 0, frames: 0, decisions: 0, diagnostics: 0 });
  });

  it('recording continues normally after a deletion: new rows for the same table are stored and counted from zero', async () => {
    const idb = new IDBFactory();
    const st = new BotStorage(idb);
    await seed(st);
    await st.deleteTables(['A']);
    expect(await st.saveHand(hand('A:h:1:99', 'A', 9000), [profile('p1', 3, 900)])).toBe(true);
    await st.saveFrames([frame('sA2', 0, 'A', 'A:h:1:99', 9000)]);
    await st.saveDecision(decision('A:h:1:99', 'A', 9001));
    const a = (await new BotStorage(idb).tableSummaries()).find((t) => t.tableId === 'A')!;
    expect(a).toMatchObject({ hands: 1, frames: 1, decisions: 1, diagnostics: 0, firstSeen: 9000, lastSeen: 9000 });
    // A hand that was deleted may be stored again only if the table sends it again; the id check still prevents doubles.
    expect(await st.saveHand(hand('A:h:1:99', 'A', 9000), [])).toBe(false);
  });

  it('lists the players seen only at the selected tables, for the optional profile clean-up', async () => {
    const st = new BotStorage(new IDBFactory());
    await st.saveHand(hand('A:h:1:1', 'A', 1), [profile('p0', 1, 1), profile('p1', 1, 1), profile('p2', 1, 1)]);
    const hb = hand('B:h:1:1', 'B', 2);
    hb.seats = hb.seats.map((s) => (s.playerId === 'p0' ? s : { ...s, playerId: `${s.playerId}-b` }));
    await st.saveHand(hb, [profile('p1-b', 1, 2)]);
    expect((await st.profilesOnlyAt(['A'])).sort()).toEqual(['p1', 'p2']); // p0 also played at B
    expect(await st.profilesOnlyAt(['B'])).toEqual(['p1-b']);               // p2-b has no stored profile
  });

  it('exports exactly what a deletion would remove', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    const x = await st.exportTables(['A'], 0);
    expect([x.format, x.version, x.hands.length, x.decisions.length, x.frames.length, x.diagnostics.length, x.tables[0].tableId]).toEqual(['poker-bot-table-export', 1, 2, 3, 4, 1, 'A']);
    const rep = await st.deleteTables(['A']);
    expect([rep.hands, rep.decisions, rep.frames, rep.diagnostics]).toEqual([x.hands.length, x.decisions.length, x.frames.length, x.diagnostics.length]);
  });
});

describe('deleting recordings, sessions and log lines', () => {
  it('a session deletion removes frames only', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    expect(await st.deleteSessions(['sA'])).toMatchObject({ frames: 4, sessions: 1, hands: 0 });
    const c = await counts(st);
    expect(c.hands.length).toBe(3); expect(c.decisions).toBe(4); expect(c.frames).toBe(2);
    expect((await st.framesForSessions(['sB'])).map((f) => f.n)).toEqual([0, 1]);
  });
  it('the recording of one hand can be removed while the hand stays', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    expect((await st.deleteRecordings(['A:h:1:10'])).frames).toBe(2);
    expect((await st.framesForHand('A:h:1:10')).length).toBe(0);
    expect((await st.recentHands()).length).toBe(3);
    expect((await st.sessionSummaries()).find((s) => s.session === 'sA')).toMatchObject({ frames: 2, hands: 1 });
  });
  it('log lines are deleted one by one or all at once', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    const rows = await st.diagnosticsWithKeys();
    expect(rows.map((r) => r.message)).toEqual(['no table', 'at B', 'at A']);
    expect((await st.deleteDiagnostics([rows[1].key, 99999])).diagnostics).toBe(1);
    expect((await st.recentDiagnostics()).map((r) => r.message)).toEqual(['no table', 'at A']);
    expect((await st.deleteDiagnostics('all')).diagnostics).toBe(2);
    expect(await st.recentDiagnostics()).toEqual([]);
  });
});

describe('deleting profiles', () => {
  it('a deleted profile is not written back by a table tab that still holds the old totals', async () => {
    const idb = new IDBFactory();
    const st = new BotStorage(idb);
    await seed(st);
    expect((await st.deleteProfiles(['p1'], 5000)).profiles).toBe(1);
    // The open tab completes another hand and sends its in-memory profile (created before the deletion).
    await st.saveHand(hand('A:h:3:30', 'A', 6000), [profile('p1', 3, 900), profile('p2', 2, 900)]);
    expect((await counts(new BotStorage(idb))).profiles).toEqual(['p2:2', 'p3:1']);
    // After the tab dropped its copy, the player starts again from nothing and is stored.
    await st.saveHand(hand('A:h:4:40', 'A', 7000), [profile('p1', 1, 6500)]);
    expect((await counts(st)).profiles).toEqual(['p1:1', 'p2:2', 'p3:1']);
  });
  it('deleting one profile leaves hands and other profiles alone', async () => {
    const st = new BotStorage(new IDBFactory());
    await seed(st);
    await st.deleteProfiles(['p3', 'never-stored'], 5000);
    const c = await counts(st);
    expect(c.profiles).toEqual(['p1:2', 'p2:1']); expect(c.hands.length).toBe(3);
  });
});

describe('settings are changed by read-modify-write', () => {
  it('a page holding an older copy cannot bring back a revoked authorisation', async () => {
    let stored: Record<string, unknown> = { settings: sanitizeSettings({ ...DEFAULT_SETTINGS, authorizationConfirmed: true, authorizedTables: ['A', 'B', 'C'] }) };
    const area = { get: async () => stored, set: async (v: Record<string, unknown>) => { stored = { ...stored, ...v }; } };
    // The dashboard revokes B and C.
    await patchSettings(area, (cur) => ({ authorizedTables: cur.authorizedTables.filter((t) => t === 'A') }));
    // The popup, opened earlier, now toggles the emergency stop: its patch carries no table list.
    const next = await patchSettings(area, (cur) => ({ estop: !cur.estop }));
    expect(next.authorizedTables).toEqual(['A']);
    expect(next.estop).toBe(true);
    expect((stored.settings as { authorizedTables: string[] }).authorizedTables).toEqual(['A']);
  });
  it('the experimental engine setting defaults to version 2 and accepts only v1 or v2', () => {
    expect(DEFAULT_SETTINGS.strategyEngine).toBe('v2');
    expect(sanitizeSettings({ strategyEngine: 'ml' }).strategyEngine).toBe('v2');
    expect(sanitizeSettings({ strategyEngine: 'v1' }).strategyEngine).toBe('v1');
    expect(sanitizeSettings({}).mode).toBe('recommend');
  });
});
