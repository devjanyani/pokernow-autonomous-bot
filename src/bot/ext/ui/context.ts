// What every dashboard tab gets from the shell.
import type { LiveState, Settings } from '../records';
import type { BotStorage, TableSummary } from '../storage';

export interface Ctx {
  storage: BotStorage;
  settings(): Settings;
  saveSettings(change: Partial<Settings> | ((cur: Settings) => Partial<Settings>)): Promise<void>;
  live(): LiveState | null;
  /** The table a table tab reported within the last minute, or null. It is never deleted or revoked in bulk. */
  activeTableId(): string | null;
  nicknames(): ReadonlyMap<string, string>;
  /** Re-read the table registry (also refreshes nicknames). */
  loadTables(): Promise<TableSummary[]>;
  /** Tell open table tabs that these profiles were deleted, so they drop their in-memory copies. */
  profilesDeleted(ids: string[]): Promise<void>;
  rerender(): void;
  goto(tab: string): void;
  version: string;
}
