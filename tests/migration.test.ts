import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { DB_NAME } from '$lib/db';

// The v2 upgrade has to run against a real v1 database, so this file builds one
// with a v1-only Dexie instance and then opens the app's schema on top of it.

describe('db v1 → v2 migration', () => {
  it('backfills event_id, device_id and card identity on existing rows', async () => {
    await Dexie.delete(DB_NAME);

    const v1 = new Dexie(DB_NAME);
    v1.version(1).stores({
      cards: '++id, source, state, due, &lichess_puzzle_id, &[lichess_game_id+game_move_number]',
      reviewLog: '++id, card_id, reviewed_at',
      meta: '&key',
      syncLog: '++id, sync_type, started_at'
    });
    await v1.open();

    const puzzleId = await v1.table('cards').add({
      source: 'puzzle',
      lichess_puzzle_id: 'abc12',
      lichess_game_id: null,
      game_move_number: null,
      fen: '',
      due: 1,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 1,
      lapses: 0,
      state: 'review',
      last_reviewed_at: 1000,
      original_failure_at: null,
      added_at: 1
    });
    const gameId = await v1.table('cards').add({
      source: 'game',
      lichess_puzzle_id: null,
      lichess_game_id: 'gameXYZ',
      game_move_number: 24,
      fen: '',
      due: 1,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 1,
      lapses: 0,
      state: 'review',
      last_reviewed_at: 1000,
      original_failure_at: null,
      added_at: 1
    });

    await v1.table('reviewLog').bulkAdd([
      { card_id: puzzleId, reviewed_at: 1000, rating: 3, user_move: null, move_accepted: 1, centipawn_loss: null, duration_ms: 500 },
      { card_id: gameId, reviewed_at: 1001, rating: 4, user_move: 'e2e4', move_accepted: 1, centipawn_loss: 12, duration_ms: 900 },
      // A row whose card was deleted — must survive rather than break the upgrade.
      { card_id: 9999, reviewed_at: 1002, rating: 1, user_move: null, move_accepted: 0, centipawn_loss: null, duration_ms: 100 }
    ]);
    v1.close();

    const { db } = await import('$lib/db');
    await db.open();

    const rows = await db.reviewLog.orderBy('reviewed_at').toArray();
    expect(rows).toHaveLength(3);

    const deviceId = (await db.meta.get('device_id'))?.value;
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);

    const ids = new Set(rows.map((r) => r.event_id));
    expect(ids.size).toBe(3);
    for (const row of rows) {
      expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.device_id).toBe(deviceId);
    }

    expect(rows[0]).toMatchObject({
      card_id: puzzleId,
      source: 'puzzle',
      lichess_puzzle_id: 'abc12',
      lichess_game_id: null,
      game_move_number: null,
      rating: 3
    });
    expect(rows[1]).toMatchObject({
      card_id: gameId,
      source: 'game',
      lichess_puzzle_id: null,
      lichess_game_id: 'gameXYZ',
      game_move_number: 24
    });
    // Orphaned legacy row: no identity to recover, but not dropped.
    expect(rows[2]).toMatchObject({ card_id: 9999, lichess_puzzle_id: null, lichess_game_id: null });

    // The unique index must be live afterwards.
    await expect(
      db.reviewLog.add({ ...rows[0], id: undefined, reviewed_at: 2000 })
    ).rejects.toThrow();
  });
});
