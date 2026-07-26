import type { Grade } from 'ts-fsrs';
import { createEmptyCard, scheduler, toProjection } from './fsrs';
import { db } from './db';
import { identityKey, ORPHAN_CARD_ID } from './identity';
import type { Card, CardProjection, ReviewLog } from './types';

// FSRS scheduling is a deterministic fold over (rating, timestamp) pairs, so a
// card's SRS state is fully recoverable from its review events. That is what
// makes cross-device sync cheap: only the events travel, and each device rebuilds
// its own `cards` projection. `cards` is never synced.

/**
 * The point before which events no longer count. A puzzle re-failed on Lichess
 * is reset to `new` by syncPuzzles() and `original_failure_at` advances to the
 * new failure date, so the prior cycle's reviews must not be replayed. Reviews
 * always postdate the failure that created the card, making this a no-op for
 * cards that were never re-failed.
 */
export function resetBoundary(card: Pick<Card, 'original_failure_at'>): number {
  return card.original_failure_at ?? 0;
}

/**
 * Fold review events into the SRS state they produce. Events are sorted by
 * `reviewed_at` here — a merged log arrives in arbitrary order — and events at
 * or before `since` are ignored.
 *
 * Returns null when no event survives, meaning the card is untouched (`new`) and
 * the caller should leave its existing row alone rather than write zeros over it.
 */
export function replayEvents(events: ReviewLog[], since = 0): CardProjection | null {
  const relevant = events
    .filter((e) => e.reviewed_at >= since)
    .sort((a, b) => a.reviewed_at - b.reviewed_at || a.event_id.localeCompare(b.event_id));

  if (relevant.length === 0) return null;

  let card = createEmptyCard(new Date(relevant[0].reviewed_at));
  let last = 0;
  for (const event of relevant) {
    const at = new Date(event.reviewed_at);
    card = scheduler.repeat(card, at)[event.rating as Grade].card;
    last = event.reviewed_at;
  }
  return toProjection(card, last);
}

/** Replay one local card from its stored events and return the projection. */
export async function replayCard(cardId: number): Promise<CardProjection | null> {
  const card = await db.cards.get(cardId);
  if (!card) return null;
  const events = await db.reviewLog.where('card_id').equals(cardId).toArray();
  return replayEvents(events, resetBoundary(card));
}

export interface RebuildResult {
  cardsUpdated: number;
  orphanEvents: number;
}

/**
 * Rebuild every local card's SRS state from the merged review log. Run after a
 * pull. Events whose identity has no local card are counted as orphans and left
 * in place — the next Lichess sync creates the card, and a later rebuild picks
 * them up (see bindOrphanEvents).
 */
export async function rebuildAllCards(): Promise<RebuildResult> {
  const [cards, events] = await Promise.all([db.cards.toArray(), db.reviewLog.toArray()]);

  const byIdentity = new Map<string, ReviewLog[]>();
  for (const event of events) {
    const key = identityKey(event);
    if (!key) continue;
    const list = byIdentity.get(key);
    if (list) list.push(event);
    else byIdentity.set(key, [event]);
  }

  const updates: Array<Card> = [];
  const matched = new Set<string>();
  for (const card of cards) {
    const key = identityKey(card);
    if (!key) continue;
    const cardEvents = byIdentity.get(key);
    if (!cardEvents) continue;
    matched.add(key);

    const projection = replayEvents(cardEvents, resetBoundary(card));
    if (projection) updates.push({ ...card, ...projection });
  }

  if (updates.length > 0) await db.cards.bulkPut(updates);

  let orphanEvents = 0;
  for (const [key, list] of byIdentity) if (!matched.has(key)) orphanEvents += list.length;

  return { cardsUpdated: updates.length, orphanEvents };
}

/**
 * Attach events that arrived before their card existed. Called after a Lichess
 * sync creates cards: fills in `card_id` on matching orphan rows and replays
 * them so the card shows its true schedule the moment it appears.
 */
export async function bindOrphanEvents(): Promise<number> {
  const orphans = await db.reviewLog.where('card_id').equals(ORPHAN_CARD_ID).toArray();
  if (orphans.length === 0) return 0;

  const cards = await db.cards.toArray();
  const cardByIdentity = new Map<string, Card>();
  for (const card of cards) {
    const key = identityKey(card);
    if (key) cardByIdentity.set(key, card);
  }

  let bound = 0;
  const touched = new Set<number>();
  for (const orphan of orphans) {
    const key = identityKey(orphan);
    const card = key ? cardByIdentity.get(key) : undefined;
    if (!card?.id) continue;
    await db.reviewLog.update(orphan.id!, { card_id: card.id });
    touched.add(card.id);
    bound++;
  }

  for (const cardId of touched) {
    const projection = await replayCard(cardId);
    if (projection) await db.cards.update(cardId, projection);
  }

  return bound;
}
