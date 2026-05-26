import { json } from "@sveltejs/kit";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { d as db } from "../../../../chunks/db.js";
import { a as fetchPuzzleFailures, f as fetchAnalyzedGames } from "../../../../chunks/lichess.js";
const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
function getConfig(key) {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
  return row?.value;
}
function setConfig(key, value) {
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
}
async function syncPuzzles() {
  const since = getConfig("last_puzzle_sync");
  const logId = db.prepare("INSERT INTO sync_log (sync_type, started_at) VALUES (?, ?)").run("puzzles", Date.now()).lastInsertRowid;
  try {
    const failures = await fetchPuzzleFailures(since ? parseInt(since) : void 0);
    const upsert = db.prepare(`
      INSERT INTO cards
        (source, lichess_puzzle_id, puzzle_rating, puzzle_themes, solution_moves,
         fen, last_move, original_failure_at)
      VALUES ('puzzle', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(lichess_puzzle_id) DO UPDATE SET
        due              = unixepoch() * 1000,
        stability        = 0,
        difficulty       = 0,
        elapsed_days     = 0,
        scheduled_days   = 0,
        reps             = 0,
        lapses           = 0,
        state            = 'new',
        last_reviewed_at = NULL,
        original_failure_at = excluded.original_failure_at
    `);
    let added = 0;
    db.transaction(() => {
      for (const f of failures) {
        const r = upsert.run(
          f.puzzle.id,
          f.puzzle.rating,
          f.puzzle.themes,
          JSON.stringify(f.puzzle.solution),
          f.puzzle.fen,
          f.puzzle.lastMove,
          f.date
        );
        if (r.changes > 0) added++;
      }
      if (failures.length > 0) setConfig("last_puzzle_sync", String(failures[0].date));
    })();
    db.prepare("UPDATE sync_log SET completed_at=?, items_fetched=?, items_added=? WHERE id=?").run(
      Date.now(),
      failures.length,
      added,
      logId
    );
    return { fetched: failures.length, added };
  } catch (err) {
    db.prepare("UPDATE sync_log SET completed_at=?, error=? WHERE id=?").run(
      Date.now(),
      String(err),
      logId
    );
    throw err;
  }
}
async function syncGames() {
  const username = getConfig("lichess_username");
  if (!username) throw new Error("Username not configured");
  const since = getConfig("last_game_sync");
  const logId = db.prepare("INSERT INTO sync_log (sync_type, started_at) VALUES (?, ?)").run("games", Date.now()).lastInsertRowid;
  try {
    const games = await fetchAnalyzedGames(username, since ? parseInt(since) : void 0);
    let added = 0;
    for (const game of games) {
      added += extractBlunders(game, username);
    }
    if (games.length > 0) setConfig("last_game_sync", String(Date.now()));
    db.prepare("UPDATE sync_log SET completed_at=?, items_fetched=?, items_added=? WHERE id=?").run(
      Date.now(),
      games.length,
      added,
      logId
    );
    return { fetched: games.length, added };
  } catch (err) {
    db.prepare("UPDATE sync_log SET completed_at=?, error=? WHERE id=?").run(
      Date.now(),
      String(err),
      logId
    );
    throw err;
  }
}
function extractBlunders(game, username) {
  if (!game.analysis || !game.moves.trim()) return 0;
  const userColor = game.players.white.user?.name?.toLowerCase() === username.toLowerCase() ? "white" : "black";
  const sanMoves = game.moves.trim().split(/\s+/);
  const analysis = game.analysis;
  const setup = parseFen(STARTING_FEN).unwrap();
  let pos = Chess.fromSetup(setup).unwrap();
  const insert = db.prepare(`
    INSERT INTO cards
      (source, lichess_game_id, game_move_number, played_move, best_move,
       eval_before, eval_after, judgment, fen, last_move, original_failure_at)
    VALUES ('game', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(lichess_game_id, game_move_number) DO NOTHING
  `);
  let added = 0;
  let prevUci = null;
  for (let i = 0; i < sanMoves.length && i < analysis.length; i++) {
    const entry = analysis[i];
    const isUserMove = i % 2 === 0 === (userColor === "white");
    if (isUserMove && entry.judgment && entry.judgment.name !== "Inaccuracy") {
      const fenBefore = makeFen(pos.toSetup());
      const evalBefore = i > 0 ? analysis[i - 1]?.eval ?? null : null;
      const blunderMove = parseSan(pos, sanMoves[i]);
      const blunderUci = blunderMove ? makeUci(blunderMove) : null;
      const r = insert.run(
        game.id,
        i,
        blunderUci,
        entry.best ?? null,
        evalBefore,
        entry.eval ?? null,
        entry.judgment.name,
        fenBefore,
        prevUci,
        null
      );
      if (r.changes > 0) added++;
    }
    const move = parseSan(pos, sanMoves[i]);
    if (!move) break;
    prevUci = makeUci(move);
    pos.play(move);
  }
  return added;
}
const POST = async () => {
  try {
    const [puzzles, games] = await Promise.all([syncPuzzles(), syncGames()]);
    return json({ puzzles, games });
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
export {
  POST
};
