import Dexie from "dexie";
class RookRipperDB extends Dexie {
  cards;
  reviewLog;
  meta;
  syncLog;
  constructor() {
    super("rookripper");
    this.version(1).stores({
      cards: "++id, source, state, due, &lichess_puzzle_id, &[lichess_game_id+game_move_number]",
      reviewLog: "++id, card_id, reviewed_at",
      meta: "&key",
      syncLog: "++id, sync_type, started_at"
    });
  }
}
const db = new RookRipperDB();
async function getMeta(key) {
  return (await db.meta.get(key))?.value;
}
export {
  db as d,
  getMeta as g
};
