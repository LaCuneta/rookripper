import { type Grade } from 'ts-fsrs';
import { db, getMeta, setMeta } from './db';
import { scheduler, toFSRS, toProjection } from './fsrs';
import { getDeviceId } from './device';
import { identityKey } from './identity';
import type { Card, DueStats, ReviewLog } from './types';

// ts-fsrs is pure JS and runs unchanged in the browser. This module is the
// former src/lib/server/srs.ts, ported from synchronous better-sqlite3 calls to
// async Dexie queries.

export async function applyReview(
  cardId: number,
  rating: Grade,
  userMove: string | null,
  moveAccepted: boolean,
  centipawnLoss: number | null,
  durationMs: number | null,
  // Injectable clock. Production always passes the default; tests drive
  // multi-day histories through this exact code path by advancing it.
  now: number = Date.now()
): Promise<void> {
  const deviceId = await getDeviceId();

  await db.transaction('rw', db.cards, db.reviewLog, async () => {
    const card = await db.cards.get(cardId);
    if (!card) throw new Error(`Card ${cardId} not found`);

    const next = scheduler.repeat(toFSRS(card), new Date(now))[rating].card;

    await db.cards.update(cardId, toProjection(next, now));

    await db.reviewLog.add({
      event_id: crypto.randomUUID(),
      device_id: deviceId,
      card_id: cardId,
      source: card.source,
      lichess_puzzle_id: card.lichess_puzzle_id,
      lichess_game_id: card.lichess_game_id,
      game_move_number: card.game_move_number,
      reviewed_at: now,
      rating,
      user_move: userMove,
      move_accepted: moveAccepted ? 1 : 0,
      centipawn_loss: centipawnLoss,
      duration_ms: durationMs
    });
  });
}

export interface NewCardInfo {
  /** Effective cap for today (dailyLimit + extraToday, or Infinity if unlimited). */
  limit: number;
  usedToday: number;
  dailyLimit: number;
  extraToday: number;
  startOfDay: number;
}

export async function getNewCardInfo(): Promise<NewCardInfo> {
  const dailyLimit = parseInt((await getMeta('new_cards_per_day')) ?? '20') || 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfDay = today.getTime();
  const dateStr = today.toISOString().slice(0, 10);

  let extraToday = 0;
  const extraRaw = await getMeta('extra_new_today');
  if (extraRaw) {
    const [d, n] = extraRaw.split(':');
    if (d === dateStr) extraToday = parseInt(n) || 0;
  }

  const usedToday = await countNewToday(startOfDay);

  const limit = dailyLimit === 0 ? Infinity : dailyLimit + extraToday;
  return { limit, usedToday, dailyLimit, extraToday, startOfDay };
}

/**
 * How many cards were *started* today: distinct card identities whose earliest
 * review event falls on or after `startOfDay`.
 *
 * Counted from `reviewLog` rather than from `cards.reps === 1` so that the cap
 * is shared across devices — once events merge, a card started on one device is
 * already counted on the other. Keying on identity also means two devices that
 * raced and both reviewed the same new card burn one slot, not two.
 */
async function countNewToday(startOfDay: number): Promise<number> {
  const todays = await db.reviewLog.where('reviewed_at').aboveOrEqual(startOfDay).toArray();

  const seen = new Set<string>();
  let count = 0;
  for (const event of todays) {
    const key = identityKey(event) ?? `c:${event.card_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if ((await earlierEventCount(event, startOfDay)) === 0) count++;
  }
  return count;
}

/** Events for the same card strictly before `before` — 0 means "started today". */
async function earlierEventCount(event: ReviewLog, before: number): Promise<number> {
  if (event.source === 'puzzle' && event.lichess_puzzle_id) {
    return db.reviewLog
      .where('[lichess_puzzle_id+reviewed_at]')
      .between([event.lichess_puzzle_id, 0], [event.lichess_puzzle_id, before], true, false)
      .count();
  }
  if (event.source === 'game' && event.lichess_game_id && event.game_move_number != null) {
    const g = event.lichess_game_id;
    const n = event.game_move_number;
    return db.reviewLog
      .where('[lichess_game_id+game_move_number+reviewed_at]')
      .between([g, n, 0], [g, n, before], true, false)
      .count();
  }
  // Identity-less legacy row (its card was deleted): fall back to the local id.
  return db.reviewLog
    .where('card_id')
    .equals(event.card_id)
    .filter((e) => e.reviewed_at < before)
    .count();
}

export async function getDueCard(source?: 'puzzle' | 'game'): Promise<Card | null> {
  const now = Date.now();
  const { limit, usedToday } = await getNewCardInfo();
  const allowNew = usedToday < limit;

  const candidates = await db.cards
    .where('due')
    .belowOrEqual(now)
    .filter((c) => {
      if (source && c.source !== source) return false;
      if (!allowNew && c.state === 'new') return false;
      return true;
    })
    .toArray();

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// One-time daily override: grant `amount` extra new cards for today. Stored as
// "YYYY-MM-DD:N"; a stale (different-day) entry resets to 0 first.
export async function injectExtraNew(amount = 20): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateStr = today.toISOString().slice(0, 10);

  let current = 0;
  const raw = await getMeta('extra_new_today');
  if (raw) {
    const [d, n] = raw.split(':');
    if (d === dateStr) current = parseInt(n) || 0;
  }

  const next = current + amount;
  await setMeta('extra_new_today', `${dateStr}:${next}`);
  return next;
}

export async function getDueStats(): Promise<DueStats> {
  const now = Date.now();
  const dueNonNew = await db.cards
    .where('due')
    .belowOrEqual(now)
    .filter((c) => c.state !== 'new')
    .count();
  const newCards = await db.cards.where('state').equals('new').count();
  const learning = await db.cards
    .filter((c) => c.state === 'learning' || c.state === 'relearning')
    .count();

  const { limit, usedToday } = await getNewCardInfo();
  const newAllowed =
    limit === Infinity ? newCards : Math.max(0, Math.min(newCards, limit - usedToday));

  return { due: dueNonNew + newAllowed, new: newCards, learning };
}
