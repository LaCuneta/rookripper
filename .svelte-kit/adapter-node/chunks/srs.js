import { fsrs, State } from "ts-fsrs";
import { d as db, g as getMeta } from "./db.js";
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
async function applyReview(cardId, rating, userMove, moveAccepted, centipawnLoss, durationMs) {
  await db.transaction("rw", db.cards, db.reviewLog, async () => {
    const card = await db.cards.get(cardId);
    if (!card) throw new Error(`Card ${cardId} not found`);
    const next = scheduler.repeat(toFSRS(card), /* @__PURE__ */ new Date())[rating].card;
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
      move_accepted: 1,
      centipawn_loss: centipawnLoss,
      duration_ms: durationMs
    });
  });
}
async function getNewCardInfo() {
  const dailyLimit = parseInt(await getMeta("new_cards_per_day") ?? "20") || 0;
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const startOfDay = today.getTime();
  const dateStr = today.toISOString().slice(0, 10);
  let extraToday = 0;
  const extraRaw = await getMeta("extra_new_today");
  if (extraRaw) {
    const [d, n] = extraRaw.split(":");
    if (d === dateStr) extraToday = parseInt(n) || 0;
  }
  const usedToday = await db.cards.filter((c) => c.reps === 1 && (c.last_reviewed_at ?? 0) >= startOfDay).count();
  const limit = dailyLimit === 0 ? Infinity : dailyLimit + extraToday;
  return { limit, usedToday, dailyLimit, extraToday, startOfDay };
}
async function getDueCard(source) {
  const now = Date.now();
  const { limit, usedToday } = await getNewCardInfo();
  const allowNew = usedToday < limit;
  const candidates = await db.cards.where("due").belowOrEqual(now).filter((c) => {
    if (source && c.source !== source) return false;
    if (!allowNew && c.state === "new") return false;
    return true;
  }).toArray();
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
async function getDueStats() {
  const now = Date.now();
  const dueNonNew = await db.cards.where("due").belowOrEqual(now).filter((c) => c.state !== "new").count();
  const newCards = await db.cards.where("state").equals("new").count();
  const learning = await db.cards.filter((c) => c.state === "learning" || c.state === "relearning").count();
  const { limit, usedToday } = await getNewCardInfo();
  const newAllowed = limit === Infinity ? newCards : Math.max(0, Math.min(newCards, limit - usedToday));
  return { due: dueNonNew + newAllowed, new: newCards, learning };
}
export {
  applyReview as a,
  getDueStats as b,
  getNewCardInfo as c,
  getDueCard as g
};
