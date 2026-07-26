import { describe, it, expect, beforeEach } from 'vitest';
import { db, setMeta } from '$lib/db';
import { applyReview, getNewCardInfo } from '$lib/srs';
import { ORPHAN_CARD_ID } from '$lib/identity';
import type { ReviewLog } from '$lib/types';
import { addGameCard, addPuzzleCard, DAY, resetDb } from './helpers';

// Gap 2: the daily new-card cap is counted from reviewLog, not from local card
// state, so it stays shared once two devices merge their events.

function todayAt(hour: number): number {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** An event as it would arrive from another device after a pull. */
function peerEvent(over: Partial<ReviewLog>): ReviewLog {
  return {
    event_id: crypto.randomUUID(),
    device_id: 'peer-device',
    card_id: ORPHAN_CARD_ID,
    source: 'puzzle',
    lichess_puzzle_id: null,
    lichess_game_id: null,
    game_move_number: null,
    reviewed_at: todayAt(10),
    rating: 3,
    user_move: null,
    move_accepted: 1,
    centipawn_loss: null,
    duration_ms: null,
    ...over
  };
}

describe('getNewCardInfo', () => {
  beforeEach(resetDb);

  it('counts a card started today once, however many times it was reviewed', async () => {
    const id = await addPuzzleCard('p1', todayAt(1));
    await applyReview(id, 3, null, true, null, null, todayAt(9));
    await applyReview(id, 1, null, false, null, null, todayAt(10));
    await applyReview(id, 3, null, true, null, null, todayAt(11));

    expect((await getNewCardInfo()).usedToday).toBe(1);
  });

  it('does not count a card whose first review was on an earlier day', async () => {
    const id = await addPuzzleCard('p1', todayAt(1) - 10 * DAY);
    await applyReview(id, 3, null, true, null, null, todayAt(9) - 3 * DAY);
    await applyReview(id, 3, null, true, null, null, todayAt(9));

    expect((await getNewCardInfo()).usedToday).toBe(0);
  });

  it('counts puzzle and game cards independently', async () => {
    const p = await addPuzzleCard('p1', todayAt(1));
    const g1 = await addGameCard('gameA', 10, todayAt(1));
    const g2 = await addGameCard('gameA', 20, todayAt(1));
    for (const id of [p, g1, g2]) await applyReview(id, 3, null, true, null, null, todayAt(9));

    expect((await getNewCardInfo()).usedToday).toBe(3);
  });

  it('counts a peer device\'s event, even with no local card for it', async () => {
    const local = await addPuzzleCard('local1', todayAt(1));
    await applyReview(local, 3, null, true, null, null, todayAt(9));

    // Pulled from another device: cards this one has never synced from Lichess.
    await db.reviewLog.bulkAdd([
      peerEvent({ lichess_puzzle_id: 'peer1' }),
      peerEvent({ lichess_puzzle_id: 'peer2' }),
      peerEvent({ source: 'game', lichess_game_id: 'peerGame', game_move_number: 8 })
    ]);

    expect((await getNewCardInfo()).usedToday).toBe(4);
  });

  it('burns one slot when two devices race on the same new card', async () => {
    const id = await addPuzzleCard('raced', todayAt(1));
    await applyReview(id, 3, null, true, null, null, todayAt(9));
    // The peer reviewed the same puzzle before either device pushed.
    await db.reviewLog.add(
      peerEvent({ lichess_puzzle_id: 'raced', reviewed_at: todayAt(9) + 1000 })
    );

    expect((await getNewCardInfo()).usedToday).toBe(1);
  });

  it('applies the daily limit and the one-time extra', async () => {
    await setMeta('new_cards_per_day', '5');
    const info = await getNewCardInfo();
    expect(info.dailyLimit).toBe(5);
    expect(info.limit).toBe(5);

    const date = new Date();
    date.setHours(0, 0, 0, 0);
    await setMeta('extra_new_today', `${date.toISOString().slice(0, 10)}:20`);
    expect((await getNewCardInfo()).limit).toBe(25);
  });

  it('treats a zero limit as unlimited', async () => {
    await setMeta('new_cards_per_day', '0');
    expect((await getNewCardInfo()).limit).toBe(Infinity);
  });
});
