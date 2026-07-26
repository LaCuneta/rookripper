// A user-visible log of what sync actually did: what was fetched, how conflicts
// were resolved, and what was sent back. Distinct from the Dexie `syncLog`
// table, which records Lichess puzzle/game imports.
//
// Persisted in localStorage rather than held in memory because the review page
// reloads the document after every card — an in-memory log would be wiped
// several times a minute, exactly when there is most to record.

const STORAGE_KEY = 'rookripper_sync_activity';
const MAX_ENTRIES = 200;

export type SyncLogLevel = 'info' | 'success' | 'warn' | 'error';

export interface SyncLogEntry {
  at: number;
  level: SyncLogLevel;
  message: string;
  /** Secondary text: an error body, a version, a breakdown of counts. */
  detail?: string;
}

let cache: SyncLogEntry[] | null = null;
const listeners = new Set<(entries: SyncLogEntry[]) => void>();

function read(): SyncLogEntry[] {
  if (cache) return cache;
  if (typeof localStorage === 'undefined') return (cache = []);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(entries: SyncLogEntry[]): void {
  cache = entries;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Quota or private-mode failure: the log is diagnostic, never load-bearing.
    }
  }
  for (const fn of listeners) fn(entries);
}

/** Newest first. */
export function getSyncActivity(): SyncLogEntry[] {
  return read();
}

export function logSync(level: SyncLogLevel, message: string, detail?: string): void {
  const entry: SyncLogEntry = { at: Date.now(), level, message };
  if (detail) entry.detail = detail;
  write([entry, ...read()].slice(0, MAX_ENTRIES));
}

export function clearSyncActivity(): void {
  write([]);
}

export function subscribeSyncActivity(fn: (entries: SyncLogEntry[]) => void): () => void {
  listeners.add(fn);
  fn(read());
  return () => listeners.delete(fn);
}

/** Test seam — drops the in-process cache so a cleared store is re-read. */
export function resetSyncActivityCache(): void {
  cache = null;
}
