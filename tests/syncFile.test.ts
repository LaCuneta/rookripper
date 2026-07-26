import { describe, it, expect, beforeEach } from 'vitest';
import { db, getMeta, setMeta } from '$lib/db';
import { applyReview } from '$lib/srs';
import { ORPHAN_CARD_ID } from '$lib/identity';
import { bindOrphanEvents } from '$lib/replay';
import { buildSyncFile, mergeSyncFile, reconcileMeta, assertSyncFile } from '$lib/syncFile';
import type { SyncFile } from '$lib/syncFile';
import { addGameCard, addPuzzleCard, DAY, resetDb } from './helpers';

// Two devices are simulated by building a sync file from one database state,
// resetting to a different state, and merging the file in — the same path a
// real pull takes.

function projection(card: { due: number; stability: number; reps: number; lapses: number; state: string }) {
  return { due: card.due, stability: card.stability, reps: card.reps, lapses: card.lapses, state: card.state };
}

describe('reconcileMeta', () => {
  it('takes the furthest-along Lichess cursor', () => {
    expect(reconcileMeta({ last_puzzle_sync: '100' }, { last_puzzle_sync: '500' })).toEqual({
      last_puzzle_sync: '500'
    });
    // Ours is already ahead: nothing to change.
    expect(reconcileMeta({ last_puzzle_sync: '900' }, { last_puzzle_sync: '500' })).toEqual({});
  });

  it('adopts a cursor we have never had', () => {
    expect(reconcileMeta({}, { last_game_sync: '42' })).toEqual({ last_game_sync: '42' });
  });

  it('keeps the larger bonus on the same day and the later date otherwise', () => {
    expect(
      reconcileMeta({ extra_new_today: '2026-07-26:20' }, { extra_new_today: '2026-07-26:40' })
    ).toEqual({ extra_new_today: '2026-07-26:40' });

    expect(
      reconcileMeta({ extra_new_today: '2026-07-25:60' }, { extra_new_today: '2026-07-26:20' })
    ).toEqual({ extra_new_today: '2026-07-26:20' });

    expect(
      reconcileMeta({ extra_new_today: '2026-07-26:20' }, { extra_new_today: '2026-07-25:60' })
    ).toEqual({});
  });

  it('resolves new_cards_per_day by write time', () => {
    expect(
      reconcileMeta({ new_cards_per_day: '20' }, { new_cards_per_day: '30' }, { new_cards_per_day: 100 }, { new_cards_per_day: 200 })
    ).toEqual({ new_cards_per_day: '30' });

    // Our write is newer — keep it.
    expect(
      reconcileMeta({ new_cards_per_day: '20' }, { new_cards_per_day: '30' }, { new_cards_per_day: 300 }, { new_cards_per_day: 200 })
    ).toEqual({});
  });
});

describe('mergeSyncFile', () => {
  beforeEach(resetDb);

  it('rejects a file from a newer format version', async () => {
    expect(() => assertSyncFile({ app: 'rookripper', events: [], version: 99 })).toThrow(/newer version/);
    expect(() => assertSyncFile({ app: 'something-else', events: [] })).toThrow(/not a RookRipper/);
  });

  it('converges two devices on the same state', async () => {
    const start = Date.now() - 30 * DAY;

    // Device A: reviews puzzle p1 twice and game card g1 once.
    const a1 = await addPuzzleCard('p1', start);
    const a2 = await addGameCard('gameA', 10, start);
    await addPuzzleCard('p2', start); // synced from Lichess but never reviewed
    await applyReview(a1, 3, null, true, null, null, start + DAY);
    await applyReview(a1, 4, null, true, null, null, start + 5 * DAY);
    await applyReview(a2, 2, null, true, null, null, start + 2 * DAY);
    const fileA = await buildSyncFile();
    expect(fileA.events).toHaveLength(3);

    // Device B: same three cards from Lichess (different local ids), and it
    // reviewed p2, which A has never touched.
    await resetDb();
    await addGameCard('gameA', 10, start);
    const b2 = await addPuzzleCard('p2', start);
    const b1 = await addPuzzleCard('p1', start);
    await applyReview(b2, 3, null, true, null, null, start + 3 * DAY);

    const merged = await mergeSyncFile(fileA);
    expect(merged.eventsAdded).toBe(3);
    expect(merged.orphanEvents).toBe(0);

    // A's history now drives B's card state, despite the different card ids.
    const p1 = (await db.cards.get(b1))!;
    expect(p1.reps).toBe(2);
    expect(p1.state).not.toBe('new');
    // B's own review survived the merge.
    expect((await db.cards.get(b2))!.reps).toBe(1);

    // And B's file now carries the union.
    const fileB = await buildSyncFile();
    expect(fileB.events).toHaveLength(4);
  });

  it('is idempotent — merging the same file twice changes nothing', async () => {
    const start = Date.now() - 10 * DAY;
    const id = await addPuzzleCard('p1', start);
    await applyReview(id, 3, null, true, null, null, start + DAY);
    const file = await buildSyncFile();

    await resetDb();
    const localId = await addPuzzleCard('p1', start);

    const first = await mergeSyncFile(file);
    const stateAfterFirst = projection((await db.cards.get(localId))!);

    const second = await mergeSyncFile(file);
    expect(first.eventsAdded).toBe(1);
    expect(second.eventsAdded).toBe(0);
    expect(second.eventsSkipped).toBe(1);
    expect(await db.reviewLog.count()).toBe(1);
    expect(projection((await db.cards.get(localId))!)).toEqual(stateAfterFirst);
  });

  it('parks events for un-synced cards and binds them once the card arrives', async () => {
    const start = Date.now() - 10 * DAY;
    const id = await addPuzzleCard('laterPuzzle', start);
    await applyReview(id, 3, null, true, null, null, start + DAY);
    await applyReview(id, 3, null, true, null, null, start + 4 * DAY);
    const file = await buildSyncFile();

    // A fresh device: no cards at all yet.
    await resetDb();
    const merged = await mergeSyncFile(file);
    expect(merged.eventsAdded).toBe(2);
    expect(merged.orphanEvents).toBe(2);
    expect(await db.reviewLog.where('card_id').equals(ORPHAN_CARD_ID).count()).toBe(2);

    // The next Lichess sync creates the card. It is added now, but carries the
    // original failure date from Lichess — the same value device A had, so the
    // replayed events fall after the reset boundary.
    const localId = await addPuzzleCard('laterPuzzle', Date.now(), start);
    expect(await bindOrphanEvents()).toBe(2);

    // ...and it appears already scheduled, not new.
    const card = (await db.cards.get(localId))!;
    expect(card.reps).toBe(2);
    expect(card.state).not.toBe('new');
    expect(await db.reviewLog.where('card_id').equals(ORPHAN_CARD_ID).count()).toBe(0);
  });

  it('merges config by rule, not by overwrite', async () => {
    await setMeta('last_puzzle_sync', '1000');
    await setMeta('last_game_sync', '9000');

    const file: SyncFile = {
      version: 1,
      app: 'rookripper',
      exportedAt: Date.now(),
      device_id: 'peer',
      events: [],
      meta: { last_puzzle_sync: '5000', last_game_sync: '2000' },
      meta_updated_at: {}
    };

    const result = await mergeSyncFile(file);
    expect(result.metaChanged).toEqual(['last_puzzle_sync']);
    expect(await getMeta('last_puzzle_sync')).toBe('5000');
    expect(await getMeta('last_game_sync')).toBe('9000');
  });

  it('never puts a token or device_id in the file', async () => {
    await setMeta('access_token', 'lichess-secret');
    await setMeta('google_access_token', 'google-secret');
    await setMeta('lichess_username', 'someone');
    await setMeta('new_cards_per_day', '25');

    const file = await buildSyncFile();
    const serialized = JSON.stringify(file);

    expect(serialized).not.toContain('lichess-secret');
    expect(serialized).not.toContain('google-secret');
    expect(serialized).not.toContain('someone');
    expect(file.meta).toEqual({ new_cards_per_day: '25' });
  });
});
