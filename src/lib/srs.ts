import { fsrs, State, type Grade, type Card as FSRSCard } from 'ts-fsrs';
import { db, getMeta, setMeta } from './db';
import type { Card, CardState, DueStats } from './types';

// ts-fsrs is pure JS and runs unchanged in the browser. This module is the
// former src/lib/server/srs.ts, ported from synchronous better-sqlite3 calls to
// async Dexie queries.
const scheduler = fsrs();

function toFSRS(card: Card): FSRSCard {
  const stateMap: Record<string, State> = {
    new: State.New,
    learning: State.Learning,
    review: State.Review,
    relearning: State.Relearning
  };
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: stateMap[card.state] ?? State.New,
    last_review: card.last_reviewed_at ? new Date(card.last_reviewed_at) : undefined
  };
}

function stateLabel(s: State): CardState {
  return (
    ({
      [State.New]: 'new',
      [State.Learning]: 'learning',
      [State.Review]: 'review',
      [State.Relearning]: 'relearning'
    }[s] as CardState) ?? 'new'
  );
}

export async function applyReview(
  cardId: number,
  rating: Grade,
  userMove: string | null,
  moveAccepted: boolean,
  centipawnLoss: number | null,
  durationMs: number | null
): Promise<void> {
  await db.transaction('rw', db.cards, db.reviewLog, async () => {
    const card = await db.cards.get(cardId);
    if (!card) throw new Error(`Card ${cardId} not found`);

    const next = scheduler.repeat(toFSRS(card), new Date())[rating].card;
    const now = Date.now();

    await db.cards.update(cardId, {
      due: next.due.getTime(),
      stability: next.stability,
      difficulty: next.difficulty,
      elapsed_days: next.elapsed_days,
      scheduled_days: next.scheduled_days,
      reps: next.reps,
      lapses: next.lapses,
      state: stateLabel(next.state),
      last_reviewed_at: now
    });

    await db.reviewLog.add({
      card_id: cardId,
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

  // A card is "new today" once it has been reviewed exactly once (reps === 1)
  // and that review happened today.
  const usedToday = await db.cards
    .filter((c) => c.reps === 1 && (c.last_reviewed_at ?? 0) >= startOfDay)
    .count();

  const limit = dailyLimit === 0 ? Infinity : dailyLimit + extraToday;
  return { limit, usedToday, dailyLimit, extraToday, startOfDay };
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
