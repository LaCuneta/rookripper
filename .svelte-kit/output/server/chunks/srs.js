import { fsrs, State } from "ts-fsrs";
import { d as db } from "./db.js";
const scheduler = fsrs();
function toFSRS(card) {
  const stateMap = {
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
    last_review: card.last_reviewed_at ? new Date(card.last_reviewed_at) : void 0
  };
}
function stateLabel(s) {
  return {
    [State.New]: "new",
    [State.Learning]: "learning",
    [State.Review]: "review",
    [State.Relearning]: "relearning"
  }[s] ?? "new";
}
function applyReview(cardId, rating, userMove, moveAccepted, centipawnLoss, durationMs) {
  const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
  if (!card) throw new Error(`Card ${cardId} not found`);
  const scheduling = scheduler.repeat(toFSRS(card), /* @__PURE__ */ new Date());
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
function getDueCard() {
  return db.prepare("SELECT * FROM cards WHERE due <= ? ORDER BY due ASC LIMIT 1").get(Date.now()) ?? null;
}
function getDueStats() {
  const now = Date.now();
  const due = db.prepare("SELECT COUNT(*) as n FROM cards WHERE due <= ?").get(now).n;
  const newCards = db.prepare("SELECT COUNT(*) as n FROM cards WHERE state = 'new'").get().n;
  const learning = db.prepare("SELECT COUNT(*) as n FROM cards WHERE state IN ('learning','relearning')").get().n;
  return { due, new: newCards, learning };
}
export {
  applyReview as a,
  getDueStats as b,
  getDueCard as g
};
