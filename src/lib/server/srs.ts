import { fsrs, Rating, State, type Grade, type Card as FSRSCard } from 'ts-fsrs';
import db from './db';
import type { Card } from '$lib/types';

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

function stateLabel(s: State): string {
  return (
    {
      [State.New]: 'new',
      [State.Learning]: 'learning',
      [State.Review]: 'review',
      [State.Relearning]: 'relearning'
    }[s] ?? 'new'
  );
}

export function applyReview(
  cardId: number,
  rating: Grade,
  userMove: string | null,
  moveAccepted: boolean,
  centipawnLoss: number | null,
  durationMs: number | null
): void {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as Card | undefined;
  if (!card) throw new Error(`Card ${cardId} not found`);

  const scheduling = scheduler.repeat(toFSRS(card), new Date());
  const next = scheduling[rating].card;
  const now = Date.now();

  db.transaction(() => {
    db.prepare(`
      UPDATE cards SET
        due              = ?,
        stability        = ?,
        difficulty       = ?,
        elapsed_days     = ?,
        scheduled_days   = ?,
        reps             = ?,
        lapses           = ?,
        state            = ?,
        last_reviewed_at = ?
      WHERE id = ?
    `).run(
      next.due.getTime(),
      next.stability,
      next.difficulty,
      next.elapsed_days,
      next.scheduled_days,
      next.reps,
      next.lapses,
      stateLabel(next.state),
      now,
      cardId
    );

    db.prepare(`
      INSERT INTO review_log
        (card_id, reviewed_at, rating, user_move, move_accepted, centipawn_loss, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(cardId, now, rating, userMove, moveAccepted ? 1 : 0, centipawnLoss, durationMs);
  })();
}

function getNewCardLimit(): { limit: number; usedToday: number } {
  const limitRow = db.prepare("SELECT value FROM config WHERE key = 'new_cards_per_day'").get() as { value: string } | undefined;
  const limit = limitRow ? parseInt(limitRow.value) : 20;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startOfDay = today.getTime();

  const extraRow = db.prepare("SELECT value FROM config WHERE key = 'extra_new_today'").get() as { value: string } | undefined;
  let extra = 0;
  if (extraRow) {
    const [dateStr, nStr] = extraRow.value.split(':');
    if (dateStr === today.toISOString().slice(0, 10)) extra = parseInt(nStr) || 0;
  }

  const usedToday = (db
    .prepare("SELECT COUNT(*) as n FROM cards WHERE reps = 1 AND last_reviewed_at >= ?")
    .get(startOfDay) as { n: number }).n;

  const effectiveLimit = limit === 0 ? Infinity : limit + extra;
  return { limit: effectiveLimit, usedToday };
}

export function getDueCard(source?: 'puzzle' | 'game'): Card | null {
  const now = Date.now();
  const { limit, usedToday } = getNewCardLimit();
  const allowNew = usedToday < limit;

  const sourceClause = source ? 'AND source = ?' : '';
  const newExclude = allowNew ? '' : "AND state != 'new'";
  const params: unknown[] = source ? [now, source] : [now];

  return (
    (db
      .prepare(`SELECT * FROM cards WHERE due <= ? ${sourceClause} ${newExclude} ORDER BY RANDOM() LIMIT 1`)
      .get(...params) as Card | undefined) ?? null
  );
}

export function getDueStats() {
  const now = Date.now();
  const dueNonNew = (
    db.prepare("SELECT COUNT(*) as n FROM cards WHERE due <= ? AND state != 'new'").get(now) as { n: number }
  ).n;
  const newCards = (
    db.prepare("SELECT COUNT(*) as n FROM cards WHERE state = 'new'").get() as { n: number }
  ).n;
  const learning = (
    db
      .prepare("SELECT COUNT(*) as n FROM cards WHERE state IN ('learning','relearning')")
      .get() as { n: number }
  ).n;

  const { limit, usedToday } = getNewCardLimit();
  const newAllowed = limit === Infinity ? newCards : Math.max(0, Math.min(newCards, limit - usedToday));

  return { due: dueNonNew + newAllowed, new: newCards, learning };
}

