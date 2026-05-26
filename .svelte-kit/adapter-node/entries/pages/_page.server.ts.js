import { d as db } from "../../chunks/db.js";
import { b as getDueStats } from "../../chunks/srs.js";
const load = async () => {
  const stats = getDueStats();
  const recentSyncs = db.prepare(
    `SELECT sync_type, completed_at, items_added, error
       FROM sync_log
       ORDER BY started_at DESC
       LIMIT 6`
  ).all();
  const lastPuzzleSync = db.prepare("SELECT value FROM config WHERE key = 'last_puzzle_sync'").get();
  const lastGameSync = db.prepare("SELECT value FROM config WHERE key = 'last_game_sync'").get();
  return {
    stats,
    recentSyncs,
    lastPuzzleSync: lastPuzzleSync ? parseInt(lastPuzzleSync.value) : null,
    lastGameSync: lastGameSync ? parseInt(lastGameSync.value) : null
  };
};
export {
  load
};
