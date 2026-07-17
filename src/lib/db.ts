import Dexie, { type Table } from 'dexie';
import type { Card, ReviewLog, MetaRow, SyncLogRow } from './types';

// Client-side store. Replaces the former server-side SQLite database — the
// schema mirrors it so exports/imports round-trip with the legacy dump.
//
// Index notes:
//  - `&lichess_puzzle_id` and `&[lichess_game_id+game_move_number]` are unique,
//    but IndexedDB excludes records whose indexed key is null/undefined. Puzzle
//    cards (game id null) and game cards (puzzle id null) therefore sit in only
//    the index that applies to them, so the uniqueness never collides.
export class RookRipperDB extends Dexie {
  cards!: Table<Card, number>;
  reviewLog!: Table<ReviewLog, number>;
  meta!: Table<MetaRow, string>;
  syncLog!: Table<SyncLogRow, number>;

  constructor() {
    super('rookripper');
    this.version(1).stores({
      cards: '++id, source, state, due, &lichess_puzzle_id, &[lichess_game_id+game_move_number]',
      reviewLog: '++id, card_id, reviewed_at',
      meta: '&key',
      syncLog: '++id, sync_type, started_at'
    });
  }
}

export const db = new RookRipperDB();

// ── Meta (key/value config) ────────────────────────────────────────────────
export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(key: string): Promise<void> {
  await db.meta.delete(key);
}

// ── Durability ─────────────────────────────────────────────────────────────
// Ask the browser to make our IndexedDB data persistent (exempt from eviction
// under storage pressure). Best-effort: returns whether persistence is granted.
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
