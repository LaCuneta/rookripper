import Dexie, { type Table } from 'dexie';
import type { Card, ReviewLog, MetaRow, SyncLogRow } from './types';

export const DB_NAME = 'rookripper';

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
    super(DB_NAME);
    this.version(1).stores({
      cards: '++id, source, state, due, &lichess_puzzle_id, &[lichess_game_id+game_move_number]',
      reviewLog: '++id, card_id, reviewed_at',
      meta: '&key',
      syncLog: '++id, sync_type, started_at'
    });

    // v2 makes review events mergeable across devices: a unique client-generated
    // `event_id` to dedupe on, and the Lichess identity denormalised onto each
    // row so events can be correlated (and stored) without a local card. The
    // identity indexes are compound with `reviewed_at` so "first review of this
    // card" is an index range rather than a scan.
    this.version(2)
      .stores({
        reviewLog:
          '++id, &event_id, card_id, reviewed_at, [lichess_puzzle_id+reviewed_at], [lichess_game_id+game_move_number+reviewed_at]'
      })
      .upgrade(async (tx) => {
        const meta = tx.table<MetaRow, string>('meta');
        let deviceId = (await meta.get('device_id'))?.value;
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          await meta.put({ key: 'device_id', value: deviceId });
        }

        const log = tx.table<ReviewLog, number>('reviewLog');
        const rows = await log.toArray();
        if (rows.length === 0) return;

        // Identity is resolved from an up-front card map rather than a lookup
        // per row: Dexie's `modify` callback is synchronous and would silently
        // drop an awaited read.
        const cards = await tx.table<Card, number>('cards').toArray();
        const byId = new Map(cards.map((c) => [c.id!, c]));

        // Existing rows are all local, so any fresh UUID is a valid identity. A
        // row whose card was deleted keeps a null identity — it is skipped by
        // sync rather than lost.
        await log.bulkPut(
          rows.map((row) => {
            const card = byId.get(row.card_id);
            return {
              ...row,
              event_id: crypto.randomUUID(),
              device_id: deviceId!,
              source: card?.source ?? 'puzzle',
              lichess_puzzle_id: card?.lichess_puzzle_id ?? null,
              lichess_game_id: card?.lichess_game_id ?? null,
              game_move_number: card?.game_move_number ?? null
            };
          })
        );
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
