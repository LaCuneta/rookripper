import { db } from './db';
import { getDeviceId } from './device';
import { identityKey, ORPHAN_CARD_ID } from './identity';
import { rebuildAllCards } from './replay';
import type { Backup, ReviewLog } from './types';

// SRS state is the only genuinely irreplaceable data (puzzles/games re-sync
// from Lichess), so export/import is both a backup and the day-one sync story.
// The shape matches scripts/dump-sql-to-json.mjs so a legacy dump imports here.

// Only cursors/limits travel with a backup — never the access token.
const BACKUP_META_KEYS = [
  'last_puzzle_sync',
  'last_game_sync',
  'new_cards_per_day',
  'extra_new_today'
];

export async function exportData(): Promise<Backup> {
  const [cards, reviewLog, metaRows] = await Promise.all([
    db.cards.toArray(),
    db.reviewLog.toArray(),
    db.meta.toArray()
  ]);

  const meta: Record<string, string> = {};
  for (const row of metaRows) {
    if (BACKUP_META_KEYS.includes(row.key)) meta[row.key] = row.value;
  }

  return { version: 1, app: 'rookripper', exportedAt: Date.now(), cards, reviewLog, meta };
}

function assertBackup(data: unknown): asserts data is Backup {
  const b = data as Partial<Backup>;
  if (!b || b.app !== 'rookripper' || !Array.isArray(b.cards) || !Array.isArray(b.reviewLog)) {
    throw new Error('Not a valid RookRipper backup file.');
  }
}

export interface ImportResult {
  cards: number;
  reviewLog: number;
}

// mode 'replace' wipes existing cards/log first (a clean restore); 'merge'
// upserts on top of what's there (bulkPut overwrites rows with matching ids).
export async function importData(
  data: unknown,
  mode: 'replace' | 'merge' = 'replace'
): Promise<ImportResult> {
  assertBackup(data);

  const deviceId = await getDeviceId();

  // Identity of each incoming event, taken from the backup's own cards — the
  // backup's card_ids are its device's auto-increments and mean nothing here.
  const backupCards = new Map(data.cards.filter((c) => c.id != null).map((c) => [c.id!, c]));

  let inserted = 0;
  await db.transaction('rw', db.cards, db.reviewLog, db.meta, async () => {
    if (mode === 'replace') {
      await db.cards.clear();
      await db.reviewLog.clear();
    }
    await db.cards.bulkPut(data.cards);

    const localByIdentity = new Map<string, number>();
    for (const card of await db.cards.toArray()) {
      const key = identityKey(card);
      if (key && card.id != null) localByIdentity.set(key, card.id);
    }

    const existingEventIds = new Set(
      (await db.reviewLog.toArray()).map((r) => r.event_id).filter(Boolean)
    );

    const rows: ReviewLog[] = [];
    for (const raw of data.reviewLog) {
      // Pre-v2 backups carry no event identity; mint one so the row can sync.
      const event_id = raw.event_id ?? crypto.randomUUID();
      if (existingEventIds.has(event_id)) continue;
      existingEventIds.add(event_id);

      const origin = raw.card_id != null ? backupCards.get(raw.card_id) : undefined;
      const identity = {
        source: raw.source ?? origin?.source ?? 'puzzle',
        lichess_puzzle_id: raw.lichess_puzzle_id ?? origin?.lichess_puzzle_id ?? null,
        lichess_game_id: raw.lichess_game_id ?? origin?.lichess_game_id ?? null,
        game_move_number: raw.game_move_number ?? origin?.game_move_number ?? null
      };
      const key = identityKey(identity);

      rows.push({
        // No `id`: it is a local auto-increment and the backup's is not ours.
        event_id,
        device_id: raw.device_id ?? deviceId,
        card_id: (key && localByIdentity.get(key)) || ORPHAN_CARD_ID,
        ...identity,
        reviewed_at: raw.reviewed_at,
        rating: raw.rating,
        user_move: raw.user_move ?? null,
        move_accepted: raw.move_accepted ?? 1,
        centipawn_loss: raw.centipawn_loss ?? null,
        duration_ms: raw.duration_ms ?? null
      });
    }

    await db.reviewLog.bulkAdd(rows);
    inserted = rows.length;

    for (const [key, value] of Object.entries(data.meta ?? {})) {
      await db.meta.put({ key, value });
    }
  });

  // Imported history supersedes whatever schedule the backup's cards carried.
  await rebuildAllCards();

  return { cards: data.cards.length, reviewLog: inserted };
}

// Cursors are cleared along with the cards, otherwise `since` would suppress
// re-syncing the very failures that were just deleted, leaving no way back.
// The access token and new-card limit are settings, not progress, so they stay.
const PROGRESS_META_KEYS = [
  'last_puzzle_sync',
  'last_game_sync',
  'extra_new_today',
  // Otherwise a reset would resume paging from deep in the history it just
  // deleted, leaving the recent failures unreachable.
  'puzzle_backfill_before',
  'puzzle_history_exhausted',
  'puzzle_backfill_at'
];

export interface DeleteResult {
  cards: number;
  reviewLog: number;
}

export async function deleteAllProgress(): Promise<DeleteResult> {
  const [cards, reviewLog] = await Promise.all([db.cards.count(), db.reviewLog.count()]);

  await db.transaction('rw', db.cards, db.reviewLog, db.meta, db.syncLog, async () => {
    await db.cards.clear();
    await db.reviewLog.clear();
    await db.syncLog.clear();
    for (const key of PROGRESS_META_KEYS) await db.meta.delete(key);
  });

  return { cards, reviewLog };
}

// ── Browser file helpers ────────────────────────────────────────────────────
export function downloadBackup(backup: Backup): void {
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rookripper-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readBackupFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}
