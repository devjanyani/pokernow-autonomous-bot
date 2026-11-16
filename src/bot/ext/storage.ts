// ============================================================
// Local persistence (IndexedDB in the EXTENSION origin, never the poker site's).
//
// Database "poker-bot" v3
//   profiles     key playerId                                   PlayerProfile
//   hands        key handId; index ts, tableId (v3)             HandRecord            (capped)
//   decisions    autoIncrement; index handId, ts, tableId (v3)  DecisionRecord        (capped)
//   diagnostics  autoIncrement; index ts, tableId (v3)          DiagnosticRecord      (capped)
//   frames       autoIncrement; index ts (wall clock), handKey, tableId (v3, obs.tableId), session (v3)
//                                                               DebugFrame            (capped, v2)
//   meta         key 'key'      counters (frames pruned), profile tombstones          (v2)
//   tables       key tableId    TableRow: nickname, first / last seen                 (v3)
//   sessions     key session    SessionRow: one page session of recording             (v3)
//
// Upgrades only ADD stores and indexes and backfill the two new stores from the
// rows already present; no stored row is rewritten or removed by an upgrade.
//
// Deleting. Every deletion runs in ONE transaction over all the stores it
// touches, so a hand never loses its decisions or frames half way. Deleting
// hands or tables does not touch opponent profiles: a profile is a running
// total and keeps what it learned (see docs/bot/STORAGE.md). Profiles are
// deleted only by deleteProfiles, which leaves a tombstone so that a copy still
// held by an open table tab cannot write the old totals back.
//
// Opened fresh for every operation batch so it works from a Manifest V3
// service worker that may be stopped at any time. Nothing leaves the machine.
// ============================================================

import { PlayerProfile, sanitizeProfile } from '../opponents/profile';
import type { DebugFrame } from '../diag/recorder';
import { DecisionRecord, DiagnosticRecord, HandRecord, StackCheck } from './records';

export const DB_NAME = 'poker-bot';
export const DB_VERSION = 3;
export const CAPS = { hands: 5000, decisions: 20000, diagnostics: 2000, frames: 6000 };

export interface TableRow { tableId: string; nickname: string; firstSeen: number; lastSeen: number }
export interface SessionRow { session: string; tableId: string; firstWall: number; lastWall: number }
export interface TableSummary extends TableRow { hands: number; decisions: number; frames: number; diagnostics: number }
export interface SessionSummary extends SessionRow { frames: number; hands: number }
export interface DeletionReport { hands: number; decisions: number; frames: number; diagnostics: number; sessions: number; tables: number; profiles: number }
export type StoredDiagnostic = DiagnosticRecord & { key: number };
export interface TableExport {
  format: 'poker-bot-table-export'; version: 1; exportedAt: string; tables: TableRow[];
  hands: HandRecord[]; decisions: DecisionRecord[]; frames: DebugFrame[]; diagnostics: DiagnosticRecord[];
}

const emptyReport = (): DeletionReport => ({ hands: 0, decisions: 0, frames: 0, diagnostics: 0, sessions: 0, tables: 0, profiles: 0 });
const realTable = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id !== 'unknown';
const TOMBSTONE = 'profileDeleted:';

const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});
const get = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const seenTable = (cur: TableRow | undefined, tableId: string, ts: number): TableRow => {
  const r = cur ?? { tableId, nickname: '', firstSeen: 0, lastSeen: 0 };
  return { ...r, firstSeen: r.firstSeen > 0 ? Math.min(r.firstSeen, ts) : ts, lastSeen: Math.max(r.lastSeen, ts) };
};
const seenSession = (cur: SessionRow | undefined, session: string, tableId: string, wall: number): SessionRow => {
  const r = cur ?? { session, tableId, firstWall: 0, lastWall: 0 };
  return { ...r, tableId: r.tableId || tableId, firstWall: r.firstWall > 0 ? Math.min(r.firstWall, wall) : wall, lastWall: Math.max(r.lastWall, wall) };
};

/** Schema creation and upgrade. Runs inside the version-change transaction. */
function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  const has = (s: string) => db.objectStoreNames.contains(s);
  if (!has('profiles')) db.createObjectStore('profiles', { keyPath: 'playerId' });
  if (!has('hands')) db.createObjectStore('hands', { keyPath: 'handId' }).createIndex('ts', 'ts');
  if (!has('decisions')) {
    const s = db.createObjectStore('decisions', { autoIncrement: true });
    s.createIndex('handId', 'handId'); s.createIndex('ts', 'ts');
  }
  if (!has('diagnostics')) db.createObjectStore('diagnostics', { autoIncrement: true }).createIndex('ts', 'ts');
  if (!has('frames')) {
    const s = db.createObjectStore('frames', { autoIncrement: true });
    s.createIndex('ts', 'wall'); s.createIndex('handKey', 'handKey');
  }
  if (!has('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  // ---- v3: per-table access paths and the two registry stores ----
  const index = (store: string, name: string, keyPath: string) => { const s = tx.objectStore(store); if (!s.indexNames.contains(name)) s.createIndex(name, keyPath); };
  index('hands', 'tableId', 'tableId');
  index('decisions', 'tableId', 'tableId');
  index('diagnostics', 'tableId', 'tableId');
  index('frames', 'tableId', 'obs.tableId');
  index('frames', 'session', 'session');
  const newTables = !has('tables'), newSessions = !has('sessions');
  if (newTables) db.createObjectStore('tables', { keyPath: 'tableId' });
  if (newSessions) db.createObjectStore('sessions', { keyPath: 'session' });
  if (oldVersion === 0 || !(newTables || newSessions)) return;
  // Backfill the registries from what is already stored (rows themselves are left exactly as they are).
  const tables = new Map<string, TableRow>(), sessions = new Map<string, SessionRow>();
  const seen = (id: unknown, ts: unknown) => {
    if (!realTable(id) || typeof ts !== 'number' || !Number.isFinite(ts)) return;
    tables.set(id, seenTable(tables.get(id), id, ts));
  };
  let open = 3;
  const finish = () => {
    if (--open) return;
    if (newTables) for (const r of tables.values()) tx.objectStore('tables').put(r);
    if (newSessions) for (const r of sessions.values()) tx.objectStore('sessions').put(r);
  };
  const scan = (store: string, each: (v: Record<string, unknown>) => void) => {
    const cur = tx.objectStore(store).openCursor();
    cur.onsuccess = () => { const c = cur.result; if (!c) return finish(); each(c.value as Record<string, unknown>); c.continue(); };
  };
  scan('hands', (h) => seen(h.tableId, h.ts));
  scan('decisions', (d) => seen(d.tableId, d.ts));
  scan('frames', (f) => {
    const tableId = (f.obs as { tableId?: unknown } | undefined)?.tableId;
    seen(tableId, f.wall);
    if (typeof f.session !== 'string' || typeof f.wall !== 'number') return;
    sessions.set(f.session, seenSession(sessions.get(f.session), f.session, realTable(tableId) ? tableId : '', f.wall));
  });
}

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, req.transaction as IDBTransaction, e.oldVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Delete every row an index holds under `key`. Resolves with the number removed. */
function deleteByIndex(store: IDBObjectStore, indexName: string, key: IDBValidKey): Promise<number> {
  return new Promise((resolve, reject) => {
    let n = 0;
    const cur = store.index(indexName).openKeyCursor(key);
    cur.onsuccess = () => { const c = cur.result; if (!c) return resolve(n); store.delete(c.primaryKey); n++; c.continue(); };
    cur.onerror = () => reject(cur.error);
  });
}
function uniqueKeys(store: IDBObjectStore, indexName: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const out: string[] = [];
    const cur = store.index(indexName).openKeyCursor(null, 'nextunique');
    cur.onsuccess = () => { const c = cur.result; if (!c) return resolve(out); if (typeof c.key === 'string') out.push(c.key); c.continue(); };
    cur.onerror = () => reject(cur.error);
  });
}
const ALL_DATA = ['hands', 'decisions', 'frames', 'diagnostics', 'tables', 'sessions'];

export class BotStorage {
  constructor(private readonly idb: IDBFactory = indexedDB) {}

  private async tx<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
    const db = await open(this.idb);
    try {
      const tx = db.transaction(stores, mode);
      const finished = done(tx);
      const out = await fn(tx);
      await finished;
      return out;
    } finally { db.close(); }
  }

  async loadProfiles(ids: string[]): Promise<PlayerProfile[]> {
    return this.tx(['profiles'], 'readonly', async (tx) => {
      const out: PlayerProfile[] = [];
      for (const id of ids) {
        const p = await get(tx.objectStore('profiles').get(id) as IDBRequest<PlayerProfile | undefined>);
        if (p) out.push(sanitizeProfile(p));
      }
      return out;
    });
  }

  async allProfiles(): Promise<PlayerProfile[]> {
    return this.tx(['profiles'], 'readonly', async (tx) => (await get(tx.objectStore('profiles').getAll() as IDBRequest<PlayerProfile[]>)).map(sanitizeProfile));
  }

  /**
   * Store a completed hand together with the profiles it produced, in ONE
   * transaction. If the hand id is already stored nothing is written, so a
   * retried message can never double-count. A profile that was deleted by the
   * user is not written back from a copy that predates the deletion.
   */
  async saveHand(hand: HandRecord, profiles: PlayerProfile[]): Promise<boolean> {
    return this.tx(['hands', 'profiles', 'tables', 'meta'], 'readwrite', async (tx) => {
      const hs = tx.objectStore('hands');
      if (await get(hs.getKey(hand.handId))) return false;
      hs.put(hand);
      // Ambiguous identities are never persisted.
      for (const p of profiles) {
        if (p.playerId.startsWith('ambiguous:')) continue;
        const dead = await get(tx.objectStore('meta').get(TOMBSTONE + p.playerId) as IDBRequest<{ key: string; value: number } | undefined>);
        if (dead && (Number(p.firstSeen) || 0) <= dead.value) continue;
        tx.objectStore('profiles').put(sanitizeProfile(p));
      }
      if (realTable(hand.tableId)) await this.touchTable(tx, hand.tableId, hand.ts);
      return true;
    }).then(async (wrote) => { if (wrote) await this.prune('hands', CAPS.hands); return wrote; });
  }

  /** Attach the next-hand stack check to a stored hand. Returns false when the hand is not stored (e.g. it was deleted). */
  async applyHandCheck(handId: string, check: StackCheck): Promise<boolean> {
    return this.tx(['hands'], 'readwrite', async (tx) => {
      const s = tx.objectStore('hands');
      const h = await get(s.get(handId) as IDBRequest<HandRecord | undefined>);
      if (!h) return false;
      s.put({ ...h, stackCheck: check });
      return true;
    });
  }

  private async touchTable(tx: IDBTransaction, tableId: string, ts: number): Promise<void> {
    const s = tx.objectStore('tables');
    s.put(seenTable(await get(s.get(tableId) as IDBRequest<TableRow | undefined>), tableId, ts));
  }

  async saveDecision(rec: DecisionRecord): Promise<void> {
    await this.tx(['decisions'], 'readwrite', (tx) => { tx.objectStore('decisions').add(rec); });
    if (Math.random() < 0.02) await this.prune('decisions', CAPS.decisions);
  }

  async saveDiagnostic(rec: DiagnosticRecord): Promise<void> {
    await this.tx(['diagnostics'], 'readwrite', (tx) => { tx.objectStore('diagnostics').add(rec); });
    if (Math.random() < 0.05) await this.prune('diagnostics', CAPS.diagnostics);
  }

  /** Append recorder frames. Storage is bounded: the oldest frames are pruned and counted. */
  async saveFrames(frames: DebugFrame[], cap = CAPS.frames): Promise<void> {
    if (!frames.length) return;
    await this.tx(['frames', 'tables', 'sessions'], 'readwrite', async (tx) => {
      for (const f of frames) tx.objectStore('frames').add(f);
      const last = frames[frames.length - 1], first = frames[0];
      const tableId = last.obs.tableId;
      if (realTable(tableId)) await this.touchTable(tx, tableId, last.wall);
      const ss = tx.objectStore('sessions');
      const t = realTable(tableId) ? tableId : '';
      ss.put(seenSession(seenSession(await get(ss.get(last.session) as IDBRequest<SessionRow | undefined>), last.session, t, first.wall), last.session, t, last.wall));
    });
    const removed = await this.prune('frames', cap);
    if (removed > 0) {
      await this.tx(['meta'], 'readwrite', async (tx) => {
        const cur = await get(tx.objectStore('meta').get('framesPruned') as IDBRequest<{ key: string; value: number } | undefined>);
        tx.objectStore('meta').put({ key: 'framesPruned', value: (cur?.value ?? 0) + removed });
      });
    }
  }

  /** Most recent frames, returned OLDEST FIRST. */
  async recentFrames(limit = CAPS.frames): Promise<DebugFrame[]> { return (await this.recent<DebugFrame>('frames', limit)).reverse(); }

  async framesPruned(): Promise<number> {
    return this.tx(['meta'], 'readonly', async (tx) => (await get(tx.objectStore('meta').get('framesPruned') as IDBRequest<{ key: string; value: number } | undefined>))?.value ?? 0);
  }

  recentDecisions(limit = 500): Promise<DecisionRecord[]> { return this.recent('decisions', limit); }

  /** Delete the oldest rows beyond `cap`. */
  async prune(store: 'hands' | 'decisions' | 'diagnostics' | 'frames', cap: number): Promise<number> {
    return this.tx([store], 'readwrite', async (tx) => {
      const s = tx.objectStore(store);
      const count = await get(s.count());
      let excess = count - cap;
      if (excess <= 0) return 0;
      const removed = excess;
      await new Promise<void>((resolve, reject) => {
        const cur = s.index('ts').openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || excess <= 0) return resolve();
          c.delete(); excess--; c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
      return removed;
    });
  }

  private async recent<T>(store: string, limit: number): Promise<T[]> {
    return this.tx([store], 'readonly', (tx) => new Promise<T[]>((resolve, reject) => {
      const out: T[] = [];
      const cur = tx.objectStore(store).index('ts').openCursor(null, 'prev');
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || out.length >= limit) return resolve(out);
        out.push(c.value as T); c.continue();
      };
      cur.onerror = () => reject(cur.error);
    }));
  }

  recentHands(limit = 200): Promise<HandRecord[]> { return this.recent('hands', limit); }
  recentDiagnostics(limit = 300): Promise<DiagnosticRecord[]> { return this.recent('diagnostics', limit); }

  /** Log lines with their storage key (needed to delete individual lines), newest first. */
  async diagnosticsWithKeys(limit = CAPS.diagnostics): Promise<StoredDiagnostic[]> {
    return this.tx(['diagnostics'], 'readonly', (tx) => new Promise<StoredDiagnostic[]>((resolve, reject) => {
      const out: StoredDiagnostic[] = [];
      const cur = tx.objectStore('diagnostics').index('ts').openCursor(null, 'prev');
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || out.length >= limit) return resolve(out);
        out.push({ ...(c.value as DiagnosticRecord), key: c.primaryKey as number }); c.continue();
      };
      cur.onerror = () => reject(cur.error);
    }));
  }

  async decisionsForHand(handId: string): Promise<DecisionRecord[]> {
    return this.tx(['decisions'], 'readonly', (tx) => get(tx.objectStore('decisions').index('handId').getAll(handId) as IDBRequest<DecisionRecord[]>));
  }

  async framesForHand(handKey: string): Promise<DebugFrame[]> {
    return this.tx(['frames'], 'readonly', (tx) => get(tx.objectStore('frames').index('handKey').getAll(handKey) as IDBRequest<DebugFrame[]>));
  }

  /** Frames of the given recording sessions, oldest first. */
  async framesForSessions(sessionIds: string[]): Promise<DebugFrame[]> {
    return this.tx(['frames'], 'readonly', async (tx) => {
      const out: DebugFrame[] = [];
      for (const id of new Set(sessionIds)) out.push(...await get(tx.objectStore('frames').index('session').getAll(id) as IDBRequest<DebugFrame[]>));
      return out.sort((a, b) => a.wall - b.wall || a.n - b.n);
    });
  }

  async exportAll(): Promise<{ profiles: PlayerProfile[]; hands: HandRecord[]; diagnostics: DiagnosticRecord[] }> {
    return { profiles: await this.allProfiles(), hands: await this.recentHands(CAPS.hands), diagnostics: await this.recentDiagnostics(CAPS.diagnostics) };
  }

  async clear(stores: ('profiles' | 'hands' | 'decisions' | 'diagnostics' | 'frames' | 'meta' | 'tables' | 'sessions')[]): Promise<void> {
    await this.tx(stores, 'readwrite', (tx) => { for (const s of stores) tx.objectStore(s).clear(); });
  }

  // ---- tables and sessions -----------------------------------------------------

  /** Every table that has a registry row or any stored record, with what is stored for it. */
  async tableSummaries(): Promise<TableSummary[]> {
    return this.tx(ALL_DATA, 'readonly', async (tx) => {
      const rows = new Map<string, TableRow>();
      for (const r of await get(tx.objectStore('tables').getAll() as IDBRequest<TableRow[]>)) rows.set(r.tableId, r);
      for (const s of ['hands', 'decisions', 'frames', 'diagnostics']) {
        for (const id of await uniqueKeys(tx.objectStore(s), 'tableId')) if (realTable(id) && !rows.has(id)) rows.set(id, { tableId: id, nickname: '', firstSeen: 0, lastSeen: 0 });
      }
      const out: TableSummary[] = [];
      for (const r of rows.values()) {
        const n = (s: string) => get(tx.objectStore(s).index('tableId').count(r.tableId));
        out.push({ ...r, nickname: r.nickname ?? '', hands: await n('hands'), decisions: await n('decisions'), frames: await n('frames'), diagnostics: await n('diagnostics') });
      }
      return out.sort((a, b) => b.lastSeen - a.lastSeen);
    });
  }

  /** Set or clear a table's nickname. Creates the registry row when the table has none yet. */
  async setNickname(tableId: string, nickname: string): Promise<void> {
    if (!realTable(tableId)) return;
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
    const clean = nickname.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40);
    await this.tx(['tables'], 'readwrite', async (tx) => {
      const s = tx.objectStore('tables');
      const cur = await get(s.get(tableId) as IDBRequest<TableRow | undefined>);
      s.put({ ...(cur ?? { tableId, firstSeen: 0, lastSeen: 0 }), nickname: clean });
    });
  }

  /** Recording sessions that still have frames, newest first. */
  async sessionSummaries(): Promise<SessionSummary[]> {
    return this.tx(['frames', 'sessions'], 'readonly', async (tx) => {
      const out: SessionSummary[] = [];
      const fs = tx.objectStore('frames');
      const rows = new Map<string, SessionRow>();
      for (const r of await get(tx.objectStore('sessions').getAll() as IDBRequest<SessionRow[]>)) rows.set(r.session, r);
      for (const id of await uniqueKeys(fs, 'session')) if (!rows.has(id)) rows.set(id, { session: id, tableId: '', firstWall: 0, lastWall: 0 });
      for (const r of rows.values()) {
        const frames = await get(fs.index('session').count(r.session));
        if (!frames) continue;
        const keys = new Set<string>();
        await new Promise<void>((resolve, reject) => {
          const cur = fs.index('session').openCursor(r.session);
          cur.onsuccess = () => { const c = cur.result; if (!c) return resolve(); const k = (c.value as DebugFrame).handKey; if (k) keys.add(k); c.continue(); };
          cur.onerror = () => reject(cur.error);
        });
        out.push({ ...r, frames, hands: keys.size });
      }
      return out.sort((a, b) => b.lastWall - a.lastWall);
    });
  }

  // ---- deletion -------------------------------------------------------------------

  /** Registry rows of sessions that no longer hold a frame are dropped (inside the caller's transaction). */
  private async sweepSessions(tx: IDBTransaction): Promise<number> {
    const ss = tx.objectStore('sessions'), fs = tx.objectStore('frames');
    let n = 0;
    for (const r of await get(ss.getAll() as IDBRequest<SessionRow[]>)) {
      if (await get(fs.index('session').count(r.session))) continue;
      ss.delete(r.session); n++;
    }
    return n;
  }

  /**
   * Delete hands with everything recorded FOR them: their decisions and their recorder frames.
   * Opponent profiles are not changed (they keep what these hands contributed).
   */
  async deleteHands(handIds: string[]): Promise<DeletionReport> {
    return this.tx(['hands', 'decisions', 'frames', 'sessions'], 'readwrite', async (tx) => {
      const r = emptyReport();
      for (const id of new Set(handIds)) {
        if (await get(tx.objectStore('hands').getKey(id))) { tx.objectStore('hands').delete(id); r.hands++; }
        r.decisions += await deleteByIndex(tx.objectStore('decisions'), 'handId', id);
        r.frames += await deleteByIndex(tx.objectStore('frames'), 'handKey', id);
      }
      r.sessions = await this.sweepSessions(tx);
      return r;
    });
  }

  /**
   * Delete all locally stored history of the given tables: hands, decisions, recorder frames, log lines and
   * recording sessions. `keepRows` lists tables whose registry row (nickname) is kept, e.g. because the table
   * is still authorised. `protect` (the table currently open) is never touched. Profiles are not changed.
   */
  async deleteTables(tableIds: string[], opts: { protect?: string | null; keepRows?: string[] } = {}): Promise<DeletionReport> {
    const ids = [...new Set(tableIds)].filter((id) => realTable(id) && id !== opts.protect);
    const keep = new Set(opts.keepRows ?? []);
    if (!ids.length) return emptyReport();
    return this.tx(ALL_DATA, 'readwrite', async (tx) => {
      const r = emptyReport();
      for (const id of ids) {
        // Hands first, by id, so that decisions and frames filed under another table id by mistake still go with their hand.
        const handIds = await get(tx.objectStore('hands').index('tableId').getAllKeys(id)) as string[];
        for (const h of handIds) {
          tx.objectStore('hands').delete(h); r.hands++;
          r.decisions += await deleteByIndex(tx.objectStore('decisions'), 'handId', h);
          r.frames += await deleteByIndex(tx.objectStore('frames'), 'handKey', h);
        }
        r.decisions += await deleteByIndex(tx.objectStore('decisions'), 'tableId', id);
        r.frames += await deleteByIndex(tx.objectStore('frames'), 'tableId', id);
        r.diagnostics += await deleteByIndex(tx.objectStore('diagnostics'), 'tableId', id);
        const ts = tx.objectStore('tables');
        const row = await get(ts.get(id) as IDBRequest<TableRow | undefined>);
        if (row) {
          if (keep.has(id)) ts.put({ ...row, firstSeen: 0, lastSeen: row.lastSeen });
          else { ts.delete(id); r.tables++; }
        }
      }
      r.sessions = await this.sweepSessions(tx);
      return r;
    });
  }

  /** Delete whole recording sessions (their frames). Hands, decisions and profiles stay. */
  async deleteSessions(sessionIds: string[]): Promise<DeletionReport> {
    return this.tx(['frames', 'sessions'], 'readwrite', async (tx) => {
      const r = emptyReport();
      for (const id of new Set(sessionIds)) r.frames += await deleteByIndex(tx.objectStore('frames'), 'session', id);
      r.sessions = await this.sweepSessions(tx);
      return r;
    });
  }

  /** Delete the recorder frames of individual hands (the recording), keeping the hand summaries. */
  async deleteRecordings(handKeys: string[]): Promise<DeletionReport> {
    return this.tx(['frames', 'sessions'], 'readwrite', async (tx) => {
      const r = emptyReport();
      for (const k of new Set(handKeys)) r.frames += await deleteByIndex(tx.objectStore('frames'), 'handKey', k);
      r.sessions = await this.sweepSessions(tx);
      return r;
    });
  }

  /** Delete log lines: the given keys, or everything when `keys` is 'all'. */
  async deleteDiagnostics(keys: number[] | 'all'): Promise<DeletionReport> {
    return this.tx(['diagnostics'], 'readwrite', async (tx) => {
      const r = emptyReport();
      const s = tx.objectStore('diagnostics');
      if (keys === 'all') { r.diagnostics = await get(s.count()); s.clear(); return r; }
      for (const k of new Set(keys)) if (await get(s.getKey(k)) !== undefined) { s.delete(k); r.diagnostics++; }
      return r;
    });
  }

  /**
   * Delete opponent profiles. A tombstone with the time of deletion is kept so that an open table tab,
   * which still holds the old totals in memory, cannot write them back with its next hand.
   */
  async deleteProfiles(ids: string[], now = Date.now()): Promise<DeletionReport> {
    return this.tx(['profiles', 'meta'], 'readwrite', async (tx) => {
      const r = emptyReport();
      for (const id of new Set(ids)) {
        if (await get(tx.objectStore('profiles').getKey(id))) { tx.objectStore('profiles').delete(id); r.profiles++; }
        tx.objectStore('meta').put({ key: TOMBSTONE + id, value: now });
      }
      return r;
    });
  }

  /** Player ids whose every stored hand was played at one of the given tables (candidates for an optional profile clean-up). */
  async profilesOnlyAt(tableIds: string[]): Promise<string[]> {
    const sel = new Set(tableIds);
    return this.tx(['hands', 'profiles'], 'readonly', async (tx) => {
      const inside = new Set<string>(), outside = new Set<string>();
      await new Promise<void>((resolve, reject) => {
        const cur = tx.objectStore('hands').openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return resolve();
          const h = c.value as HandRecord;
          for (const s of h.seats) if (s.dealtIn) (sel.has(h.tableId) ? inside : outside).add(s.playerId);
          c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
      const stored = new Set(await get(tx.objectStore('profiles').getAllKeys()) as string[]);
      return [...inside].filter((id) => !outside.has(id) && stored.has(id));
    });
  }

  /** Everything stored for the given tables, for a file the user keeps before deleting. */
  async exportTables(tableIds: string[], now = Date.now()): Promise<TableExport> {
    const ids = [...new Set(tableIds)].filter(realTable);
    return this.tx(ALL_DATA, 'readonly', async (tx) => {
      const out: TableExport = { format: 'poker-bot-table-export', version: 1, exportedAt: new Date(now).toISOString(), tables: [], hands: [], decisions: [], frames: [], diagnostics: [] };
      for (const id of ids) {
        const all = <T>(s: string) => get(tx.objectStore(s).index('tableId').getAll(id) as IDBRequest<T[]>);
        const row = await get(tx.objectStore('tables').get(id) as IDBRequest<TableRow | undefined>);
        out.tables.push(row ?? { tableId: id, nickname: '', firstSeen: 0, lastSeen: 0 });
        out.hands.push(...await all<HandRecord>('hands'));
        out.decisions.push(...await all<DecisionRecord>('decisions'));
        out.frames.push(...await all<DebugFrame>('frames'));
        out.diagnostics.push(...await all<DiagnosticRecord>('diagnostics'));
      }
      return out;
    });
  }
}
