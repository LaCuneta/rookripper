import { describe, it, expect, beforeEach } from 'vitest';
import type { Grade } from 'ts-fsrs';
import { db } from '$lib/db';
import { applyReview } from '$lib/srs';
import { replayEvents, resetBoundary, rebuildAllCards } from '$lib/replay';
import { identityKey } from '$lib/identity';
import type { Card, CardProjection, ReviewLog } from '$lib/types';
import { addGameCard, addPuzzleCard, DAY, resetDb, rng } from './helpers';

// The gate on shipping Drive sync: sync ships only review events, and every
// device rebuilds `cards` by replaying them. If replay disagrees with the state
// live scheduling produced, sync silently corrupts SRS state on every pull.

const GRADES: Grade[] = [1, 2, 3, 4];

function projectionOf(card: Card): CardProjection {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_reviewed_at: card.last_reviewed_at
  };
}

/**
 * Drive the real applyReview() over a simulated study history: each day, review
 * every card that has come due, at a random time within that day.
 */
async function simulate(opts: { days: number; seed: number; start: number }): Promise<void> {
  const rand = rng(opts.seed);
  for (let day = 0; day < opts.days; day++) {
    const dayStart = opts.start + day * DAY;
    const due = await db.cards.where('due').belowOrEqual(dayStart + DAY - 1).toArray();
    for (const card of due) {
      const at = Math.max(dayStart + Math.floor(rand() * DAY), card.last_reviewed_at ?? 0);
      const grade = GRADES[Math.floor(rand() * GRADES.length)];
      await applyReview(card.id!, grade, null, grade > 1, null, 1000, at);
    }
  }
}

async function eventsFor(cardId: number): Promise<ReviewLog[]> {
  return db.reviewLog.where('card_id').equals(cardId).toArray();
}

describe('replay fidelity', () => {
  beforeEach(resetDb);

  it('reproduces live-scheduled state for every card in a long history', async () => {
    const start = Date.UTC(2026, 0, 5, 9, 0, 0);
    for (let i = 0; i < 40; i++) await addPuzzleCard(`pz${i}`, start);
    for (let i = 0; i < 20; i++) await addGameCard(`gm${i}`, i * 2, start);

    await simulate({ days: 120, seed: 20260726, start });

    const cards = await db.cards.toArray();
    const totalEvents = await db.reviewLog.count();
    expect(cards).toHaveLength(60);
    // Guard against the simulation silently doing nothing.
    expect(totalEvents).toBeGreaterThan(400);

    for (const card of cards) {
      const events = await eventsFor(card.id!);
      expect(events.length).toBeGreaterThan(0);
      const replayed = replayEvents(events, resetBoundary(card));
      expect(replayed, `card ${card.id} (${identityKey(card)})`).toEqual(projectionOf(card));
    }
  });

  it('is order-independent — a shuffled merged log replays identically', async () => {
    const start = Date.UTC(2026, 2, 1, 8, 0, 0);
    const cardId = await addPuzzleCard('shuffle', start);
    await simulate({ days: 90, seed: 7, start });

    const card = (await db.cards.get(cardId))!;
    const events = await eventsFor(cardId);
    expect(events.length).toBeGreaterThan(3);

    const rand = rng(99);
    const shuffled = [...events].sort(() => rand() - 0.5);
    expect(replayEvents(shuffled, resetBoundary(card))).toEqual(projectionOf(card));
  });

  it('ignores events from before a re-failure reset', async () => {
    const start = Date.UTC(2026, 3, 1, 8, 0, 0);
    const cardId = await addPuzzleCard('refail', start);

    await applyReview(cardId, 3, null, true, null, 1000, start);
    await applyReview(cardId, 3, null, true, null, 1000, start + DAY);

    // syncPuzzles() resets a re-failed puzzle to `new` and advances
    // original_failure_at; the pre-reset reviews must not come back.
    const refailedAt = start + 2 * DAY;
    await db.cards.update(cardId, {
      due: refailedAt,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      state: 'new',
      last_reviewed_at: null,
      original_failure_at: refailedAt
    });

    await applyReview(cardId, 3, null, true, null, 1000, refailedAt + 3600_000);

    const card = (await db.cards.get(cardId))!;
    const replayed = replayEvents(await eventsFor(cardId), resetBoundary(card));
    expect(replayed).toEqual(projectionOf(card));
    expect(replayed!.reps).toBe(1);
  });

  it('returns null when a card has no surviving events', async () => {
    expect(replayEvents([], 0)).toBeNull();
  });

  it('rebuildAllCards restores state after the projection is wiped', async () => {
    const start = Date.UTC(2026, 4, 1, 8, 0, 0);
    for (let i = 0; i < 15; i++) await addPuzzleCard(`rb${i}`, start);
    await addGameCard('rbgame', 12, start);
    await simulate({ days: 60, seed: 5150, start });

    const before = await db.cards.toArray();

    // Simulate a fresh device that has synced cards from Lichess but has only
    // just pulled the review history: every card back at `new`.
    await db.cards.toCollection().modify((c) => {
      c.due = start;
      c.stability = 0;
      c.difficulty = 0;
      c.elapsed_days = 0;
      c.scheduled_days = 0;
      c.reps = 0;
      c.lapses = 0;
      c.state = 'new';
      c.last_reviewed_at = null;
    });

    const result = await rebuildAllCards();
    expect(result.orphanEvents).toBe(0);
    expect(result.cardsUpdated).toBe(before.length);

    const after = await db.cards.orderBy('id').toArray();
    for (const card of before.sort((a, b) => a.id! - b.id!)) {
      const rebuilt = after.find((c) => c.id === card.id)!;
      expect(projectionOf(rebuilt), `card ${card.id}`).toEqual(projectionOf(card));
    }
  });
});
