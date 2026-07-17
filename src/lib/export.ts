import { db } from './db';
import type { Backup } from './types';

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

  await db.transaction('rw', db.cards, db.reviewLog, db.meta, async () => {
    if (mode === 'replace') {
      await db.cards.clear();
      await db.reviewLog.clear();
    }
    await db.cards.bulkPut(data.cards);
    await db.reviewLog.bulkPut(data.reviewLog);
    for (const [key, value] of Object.entries(data.meta ?? {})) {
      await db.meta.put({ key, value });
    }
  });

  return { cards: data.cards.length, reviewLog: data.reviewLog.length };
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
