import { Chess } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { db, getMeta, setMeta } from './db';
import { fetchPuzzleFailures, fetchAnalyzedGames, type RawGame } from './lichess';
import type { Card } from './types';

// Browser-side sync. Formerly src/lib/server/sync.ts — chessops already runs in
// the browser, so replaying moves to derive FEN-before-blunder is unchanged;
// only the persistence moved from better-sqlite3 to Dexie.
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function blankCard(): Omit<Card, 'id'> {
  const now = Date.now();
  return {
    source: 'puzzle',
    lichess_puzzle_id: null,
    puzzle_rating: null,
    puzzle_themes: null,
    solution_moves: null,
    lichess_game_id: null,
    game_move_number: null,
    played_move: null,
    best_move: null,
    eval_before: null,
    eval_after: null,
    judgment: null,
    fen: '',
    last_move: null,
    due: now,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    last_reviewed_at: null,
    original_failure_at: null,
    added_at: now
  };
}

export async function syncPuzzles(): Promise<{ fetched: number; added: number }> {
  const since = await getMeta('last_puzzle_sync');
  const logId = await db.syncLog.add({
    sync_type: 'puzzles',
    started_at: Date.now(),
    completed_at: null,
    items_fetched: null,
    items_added: null,
    error: null
  });

  try {
    const failures = await fetchPuzzleFailures(since ? parseInt(since) : undefined);

    let added = 0;
    await db.transaction('rw', db.cards, db.meta, async () => {
      for (const f of failures) {
        const themes = Array.isArray(f.puzzle.themes)
          ? f.puzzle.themes.join(' ')
          : String(f.puzzle.themes);

        const existing = await db.cards.where('lichess_puzzle_id').equals(f.puzzle.id).first();
        if (existing) {
          // Re-failed puzzle: reset its schedule to new (mirrors the old
          // ON CONFLICT DO UPDATE, which counted as a change).
          await db.cards.update(existing.id!, {
            due: Date.now(),
            stability: 0,
            difficulty: 0,
            elapsed_days: 0,
            scheduled_days: 0,
            reps: 0,
            lapses: 0,
            state: 'new',
            last_reviewed_at: null,
            original_failure_at: f.date
          });
        } else {
          await db.cards.add({
            ...blankCard(),
            source: 'puzzle',
            lichess_puzzle_id: f.puzzle.id,
            puzzle_rating: f.puzzle.rating,
            puzzle_themes: themes,
            solution_moves: JSON.stringify(f.puzzle.solution),
            fen: f.puzzle.fen,
            last_move: f.puzzle.lastMove,
            original_failure_at: f.date
          });
        }
        added++;
      }
      // failures are newest-first; save the most recent timestamp as cursor.
      if (failures.length > 0) await setMeta('last_puzzle_sync', String(failures[0].date));
    });

    await db.syncLog.update(logId, {
      completed_at: Date.now(),
      items_fetched: failures.length,
      items_added: added
    });
    return { fetched: failures.length, added };
  } catch (err) {
    await db.syncLog.update(logId, { completed_at: Date.now(), error: String(err) });
    throw err;
  }
}

export async function syncGames(): Promise<{ fetched: number; added: number }> {
  const username = await getMeta('lichess_username');
  if (!username) throw new Error('Username not configured');

  const since = await getMeta('last_game_sync');
  const logId = await db.syncLog.add({
    sync_type: 'games',
    started_at: Date.now(),
    completed_at: null,
    items_fetched: null,
    items_added: null,
    error: null
  });

  try {
    const games = await fetchAnalyzedGames(username, since ? parseInt(since) : undefined);

    let added = 0;
    for (const game of games) {
      added += await extractBlunders(game, username);
    }

    if (games.length > 0) await setMeta('last_game_sync', String(Date.now()));

    await db.syncLog.update(logId, {
      completed_at: Date.now(),
      items_fetched: games.length,
      items_added: added
    });
    return { fetched: games.length, added };
  } catch (err) {
    await db.syncLog.update(logId, { completed_at: Date.now(), error: String(err) });
    throw err;
  }
}

async function extractBlunders(game: RawGame, username: string): Promise<number> {
  if (!game.analysis || !game.moves.trim()) return 0;

  const userColor =
    game.players.white.user?.name?.toLowerCase() === username.toLowerCase() ? 'white' : 'black';

  const sanMoves = game.moves.trim().split(/\s+/);
  const analysis = game.analysis;

  const setup = parseFen(STARTING_FEN).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();

  const toInsert: Array<Omit<Card, 'id'>> = [];
  let prevUci: string | null = null;

  for (let i = 0; i < sanMoves.length && i < analysis.length; i++) {
    const entry = analysis[i];
    const isUserMove = (i % 2 === 0) === (userColor === 'white');

    if (isUserMove && entry.judgment && entry.judgment.name !== 'Inaccuracy') {
      const fenBefore = makeFen(pos.toSetup());
      const evalBefore = i > 0 ? (analysis[i - 1]?.eval ?? null) : null;

      const blunderMove = parseSan(pos, sanMoves[i]);
      const blunderUci = blunderMove ? makeUci(blunderMove) : null;

      toInsert.push({
        ...blankCard(),
        source: 'game',
        lichess_game_id: game.id,
        game_move_number: i,
        played_move: blunderUci,
        best_move: entry.best ?? null,
        eval_before: evalBefore,
        eval_after: entry.eval ?? null,
        judgment: entry.judgment.name,
        fen: fenBefore,
        last_move: prevUci
      });
    }

    const move = parseSan(pos, sanMoves[i]);
    if (!move) break;
    prevUci = makeUci(move);
    pos.play(move);
  }

  if (toInsert.length === 0) return 0;

  // Skip positions already stored (old schema: ON CONFLICT(game_id, move_number)
  // DO NOTHING). The compound unique index would throw on a dup, so pre-filter.
  let added = 0;
  await db.transaction('rw', db.cards, async () => {
    for (const card of toInsert) {
      const exists = await db.cards
        .where('[lichess_game_id+game_move_number]')
        .equals([card.lichess_game_id!, card.game_move_number!])
        .count();
      if (exists === 0) {
        await db.cards.add(card);
        added++;
      }
    }
  });

  return added;
}

export async function syncAll(): Promise<{
  puzzles: { fetched: number; added: number };
  games: { fetched: number; added: number };
}> {
  const [puzzles, games] = await Promise.all([syncPuzzles(), syncGames()]);
  return { puzzles, games };
}
