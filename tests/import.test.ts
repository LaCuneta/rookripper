import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { db } from '$lib/db';
import { exportData, importData } from '$lib/export';
import { applyReview } from '$lib/srs';
import { ORPHAN_CARD_ID } from '$lib/identity';
import { addPuzzleCard, DAY, resetDb } from './helpers';

const SAMPLE = 'data-samples/rookripper-backup-2026-07-26.json';

describe('importData', () => {
  beforeEach(resetDb);

  it('mints sync fields for a pre-v2 backup', async () => {
    const legacy = {
      version: 1,
      app: 'rookripper',
      exportedAt: Date.now(),
      cards: [
        {
          id: 7,
          source: 'puzzle',
          lichess_puzzle_id: 'legacy1',
          lichess_game_id: null,
          game_move_number: null,
          fen: '',
          due: 1,
          stability: 1,
          difficulty: 5,
          elapsed_days: 0,
          scheduled_days: 1,
          reps: 1,
          lapses: 0,
          state: 'review',
          last_reviewed_at: 1000,
          original_failure_at: null,
          added_at: 1
        }
      ],
      // No event_id / device_id / identity — the old export shape.
      reviewLog: [
        { id: 1, card_id: 7, reviewed_at: 1000, rating: 3, user_move: null, move_accepted: 1, centipawn_loss: null, duration_ms: 500 }
      ],
      meta: { new_cards_per_day: '15' }
    };

    const result = await importData(legacy);
    expect(result.reviewLog).toBe(1);

    const row = (await db.reviewLog.toArray())[0];
    expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.device_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.source).toBe('puzzle');
    expect(row.lichess_puzzle_id).toBe('legacy1');
    expect(row.card_id).toBe(7);
    expect((await db.meta.get('new_cards_per_day'))?.value).toBe('15');
  });

  it('re-points card_id at the local card, not the backup\'s', async () => {
    // Local card for the same puzzle, but with a different auto-increment id.
    await addPuzzleCard('shared', 1);
    await addPuzzleCard('filler', 1);
    const localId = (await db.cards.where('lichess_puzzle_id').equals('shared').first())!.id!;

    await importData(
      {
        version: 1,
        app: 'rookripper',
        exportedAt: Date.now(),
        cards: [],
        reviewLog: [
          {
            event_id: 'evt-1',
            device_id: 'peer',
            card_id: 4242, // the peer's local id — meaningless here
            source: 'puzzle',
            lichess_puzzle_id: 'shared',
            lichess_game_id: null,
            game_move_number: null,
            reviewed_at: Date.now() - DAY,
            rating: 3,
            user_move: null,
            move_accepted: 1,
            centipawn_loss: null,
            duration_ms: null
          }
        ],
        meta: {}
      },
      'merge'
    );

    const row = (await db.reviewLog.where('event_id').equals('evt-1').first())!;
    expect(row.card_id).toBe(localId);
    // Replayed on import: the card is no longer new.
    expect((await db.cards.get(localId))!.reps).toBe(1);
  });

  it('parks an event with no local card as an orphan', async () => {
    await importData(
      {
        version: 1,
        app: 'rookripper',
        exportedAt: Date.now(),
        cards: [],
        reviewLog: [
          {
            event_id: 'evt-orphan',
            device_id: 'peer',
            card_id: 1,
            source: 'game',
            lichess_puzzle_id: null,
            lichess_game_id: 'notSyncedYet',
            game_move_number: 14,
            reviewed_at: Date.now(),
            rating: 4,
            user_move: null,
            move_accepted: 1,
            centipawn_loss: null,
            duration_ms: null
          }
        ],
        meta: {}
      },
      'merge'
    );

    const row = (await db.reviewLog.where('event_id').equals('evt-orphan').first())!;
    expect(row.card_id).toBe(ORPHAN_CARD_ID);
  });

  it('is idempotent — re-importing the same events adds nothing', async () => {
    const id = await addPuzzleCard('round', Date.now() - 5 * DAY);
    await applyReview(id, 3, null, true, null, null, Date.now() - 4 * DAY);
    await applyReview(id, 4, null, true, null, null, Date.now() - DAY);

    const backup = await exportData();
    const first = await importData(backup, 'merge');
    const second = await importData(backup, 'merge');

    expect(first.reviewLog).toBe(0); // every event_id already present locally
    expect(second.reviewLog).toBe(0);
    expect(await db.reviewLog.count()).toBe(2);
  });

  it.runIf(existsSync(SAMPLE))('imports the real backup sample', async () => {
    const backup = JSON.parse(readFileSync(SAMPLE, 'utf8'));
    const result = await importData(backup);

    expect(result.cards).toBe(backup.cards.length);
    expect(result.reviewLog).toBe(backup.reviewLog.length);
    expect(await db.cards.count()).toBe(backup.cards.length);

    for (const row of await db.reviewLog.toArray()) {
      expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.card_id).not.toBe(ORPHAN_CARD_ID);
      expect(row.lichess_puzzle_id ?? row.lichess_game_id).toBeTruthy();
    }
  });
});
