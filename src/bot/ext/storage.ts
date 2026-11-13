// ============================================================
// Local persistence (IndexedDB in the EXTENSION origin, never the poker site's).
//
// Database "poker-bot" v1
//   profiles     key playerId            PlayerProfile
//   hands        key handId, index ts    HandRecord            (capped)
//   decisions    autoIncrement, index handId, index ts  DecisionRecord (capped)
//   diagnostics  autoIncrement, index ts DiagnosticRecord      (capped)
//
// Opened fresh for every operation batch so it works from a Manifest V3
// service worker that may be stopped at any time. Nothing leaves the machine.
// ============================================================

import { PlayerProfile, sanitizeProfile } from '../opponents/profile';
import { DecisionRecord, DiagnosticRecord, HandRecord } from './records';

export const DB_NAME = 'poker-bot';
export const DB_VERSION = 1;
export const CAPS = { hands: 5000, decisions: 20000, diagnostics: 2000 };

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'playerId' });
      if (!db.objectStoreNames.contains('hands')) db.createObjectStore('hands', { keyPath: 'handId' }).createIndex('ts', 'ts');
      if (!db.objectStoreNames.contains('decisions')) {
        const s = db.createObjectStore('decisions', { autoIncrement: true });
        s.createIndex('handId', 'handId'); s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('diagnostics')) db.createObjectStore('diagnostics', { autoIncrement: true }).createIndex('ts', 'ts');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});
const get = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

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
   * retried message can never double-count.
   */
  async saveHand(hand: HandRecord, profiles: PlayerProfile[]): Promise<boolean> {
    return this.tx(['hands', 'profiles'], 'readwrite', async (tx) => {
      const hs = tx.objectStore('hands');
      if (await get(hs.getKey(hand.handId))) return false;
      hs.put(hand);
      // Ambiguous identities are never persisted.
      for (const p of profiles) if (!p.playerId.startsWith('ambiguous:')) tx.objectStore('profiles').put(sanitizeProfile(p));
      return true;
    }).then(async (wrote) => { if (wrote) await this.prune('hands', CAPS.hands); return wrote; });
  }

  async saveDecision(rec: DecisionRecord): Promise<void> {
    await this.tx(['decisions'], 'readwrite', (tx) => { tx.objectStore('decisions').add(rec); });
    if (Math.random() < 0.02) await this.prune('decisions', CAPS.decisions);
  }

  async saveDiagnostic(rec: DiagnosticRecord): Promise<void> {
    await this.tx(['diagnostics'], 'readwrite', (tx) => { tx.objectStore('diagnostics').add(rec); });
    if (Math.random() < 0.05) await this.prune('diagnostics', CAPS.diagnostics);
  }

  /** Delete the oldest rows beyond `cap`. */
  async prune(store: 'hands' | 'decisions' | 'diagnostics', cap: number): Promise<number> {
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

  async decisionsForHand(handId: string): Promise<DecisionRecord[]> {
    return this.tx(['decisions'], 'readonly', (tx) => get(tx.objectStore('decisions').index('handId').getAll(handId) as IDBRequest<DecisionRecord[]>));
  }

  async exportAll(): Promise<{ profiles: PlayerProfile[]; hands: HandRecord[]; diagnostics: DiagnosticRecord[] }> {
    return { profiles: await this.allProfiles(), hands: await this.recentHands(CAPS.hands), diagnostics: await this.recentDiagnostics(CAPS.diagnostics) };
  }

  async clear(stores: ('profiles' | 'hands' | 'decisions' | 'diagnostics')[]): Promise<void> {
    await this.tx(stores, 'readwrite', (tx) => { for (const s of stores) tx.objectStore(s).clear(); });
  }
}
