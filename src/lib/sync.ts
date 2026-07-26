import { Chess } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { db, getMeta, setMeta } from './db';
import {
  fetchPuzzleActivity,
  fetchAnalyzedGames,
  fetchPuzzleDashboard,
  daysSinceLichessEpoch,
  type RawGame,
  type RawPuzzleActivity
} from './lichess';
import { bindOrphanEvents } from './replay';
import type { Card } from './types';

// Browser-side sync. Formerly src/lib/server/sync.ts — chessops already runs in
// the browser, so replaying moves to derive FEN-before-blunder is unchanged;
// only the persistence moved from better-sqlite3 to Dexie.
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// `total` is undefined while streaming — ndjson gives no count up front, so the
// fetch stage can only report a running tally.
export interface SyncProgress {
  source: 'puzzles' | 'games';
  stage: 'fetching' | 'processing' | 'done';
  current: number;
  total?: number;
}

export type ProgressFn = (p: SyncProgress) => void;

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

function themeString(themes: string | string[]): string {
  return Array.isArray(themes) ? themes.join(' ') : String(themes);
}

function cardFromFailure(f: RawPuzzleActivity): Omit<Card, 'id'> {
  return {
    ...blankCard(),
    source: 'puzzle',
    lichess_puzzle_id: f.puzzle.id,
    puzzle_rating: f.puzzle.rating,
    puzzle_themes: themeString(f.puzzle.themes),
    solution_moves: JSON.stringify(f.puzzle.solution),
    fen: f.puzzle.fen,
    last_move: f.puzzle.lastMove,
    original_failure_at: f.date
  };
}

/**
 * Store failures as cards.
 *
 * `resetExisting` is the difference between the two directions of travel.
 * Catching up *forwards* means a puzzle we already hold was failed again, which
 * is new information: reset it to `new` so it comes back around. Backfilling
 * *backwards* only ever turns up failures older than what we hold, which say
 * nothing new — resetting there would wipe a live schedule with stale history.
 */
async function storeFailures(
  failures: RawPuzzleActivity[],
  resetExisting: boolean,
  onProgress?: (done: number) => void
): Promise<number> {
  let added = 0;
  let processed = 0;

  await db.transaction('rw', db.cards, async () => {
    for (const f of failures) {
      const existing = await db.cards.where('lichess_puzzle_id').equals(f.puzzle.id).first();
      if (existing) {
        if (resetExisting) {
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
          added++;
        }
      } else {
        await db.cards.add(cardFromFailure(f));
        added++;
      }
      onProgress?.(++processed);
    }
  });

  return added;
}

/**
 * Catch up on failures recorded since the last sync. Bounded by the `since`
 * cursor, so this is cheap once the first run has established one — the initial
 * history load is `backfillPuzzles()`'s job, not this one.
 */
export async function syncPuzzles(
  onProgress?: ProgressFn
): Promise<{ fetched: number; added: number }> {
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
    onProgress?.({ source: 'puzzles', stage: 'fetching', current: 0 });

    // With no cursor yet, take only the newest page: the rest of the history is
    // pulled on demand by backfillPuzzles() rather than all at once on connect.
    const page = await fetchPuzzleActivity(
      since ? { since: parseInt(since) } : { max: PAGE_SIZE },
      (scanned) => onProgress?.({ source: 'puzzles', stage: 'fetching', current: scanned })
    );

    const { entries, failures } = page;
    onProgress?.({ source: 'puzzles', stage: 'processing', current: 0, total: failures.length });

    const added = await storeFailures(failures, true, (done) =>
      onProgress?.({
        source: 'puzzles',
        stage: 'processing',
        current: done,
        total: failures.length
      })
    );

    // Entries are newest-first, so entry 0 is the high-water mark. Tracked from
    // entries rather than failures so wins since the last sync aren't rescanned.
    if (entries.length > 0) {
      await setMeta('last_puzzle_sync', String(entries[0].date));
      // Seed the backfill cursor on the first run so paging starts below this
      // page rather than re-reading it.
      if (!since) {
        await setMeta(BACKFILL_BEFORE_KEY, String(entries[entries.length - 1].date));
      }
    }

    await db.syncLog.update(logId, {
      completed_at: Date.now(),
      items_fetched: failures.length,
      items_added: added
    });
    onProgress?.({ source: 'puzzles', stage: 'done', current: added, total: failures.length });
    return { fetched: failures.length, added };
  } catch (err) {
    await db.syncLog.update(logId, { completed_at: Date.now(), error: String(err) });
    throw err;
  }
}

export async function syncGames(
  onProgress?: ProgressFn
): Promise<{ fetched: number; added: number }> {
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
    onProgress?.({ source: 'games', stage: 'fetching', current: 0 });
    const games = await fetchAnalyzedGames(username, since ? parseInt(since) : undefined, (scanned) =>
      onProgress?.({ source: 'games', stage: 'fetching', current: scanned })
    );

    let added = 0;
    onProgress?.({ source: 'games', stage: 'processing', current: 0, total: games.length });
    for (let i = 0; i < games.length; i++) {
      added += await extractBlunders(games[i], username);
      onProgress?.({
        source: 'games',
        stage: 'processing',
        current: i + 1,
        total: games.length
      });
    }

    if (games.length > 0) await setMeta('last_game_sync', String(Date.now()));

    await db.syncLog.update(logId, {
      completed_at: Date.now(),
      items_fetched: games.length,
      items_added: added
    });
    onProgress?.({ source: 'games', stage: 'done', current: added, total: games.length });
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

// ── Puzzle backfill ─────────────────────────────────────────────────────────
// The activity endpoint streams every attempt ever made, each carrying a full
// puzzle object, so loading a long history up front is by far the slowest part
// of connecting. Instead the newest page is taken on connect and older history
// is paged in only as the unreviewed supply runs down.

export const BACKFILL_BEFORE_KEY = 'puzzle_backfill_before';
export const BACKFILL_DONE_KEY = 'puzzle_history_exhausted';
const BACKFILL_AT_KEY = 'puzzle_backfill_at';

/** Entries per request. Wins are the bulk of these, so pages are cheap in cards. */
const PAGE_SIZE = 200;
/** Keep at least this many unreviewed puzzles in hand — days of buffer offline. */
export const SUPPLY_FLOOR = 60;
/** Cap on requests per top-up, so a win-heavy history can't spin. */
const MAX_PAGES = 5;
/** Don't re-check within this window; app start fires once per card. */
const BACKFILL_THROTTLE_MS = 60_000;

export async function unreviewedPuzzleCount(): Promise<number> {
  return db.cards.where('state').equals('new').filter((c) => c.source === 'puzzle').count();
}

export async function isHistoryExhausted(): Promise<boolean> {
  return (await getMeta(BACKFILL_DONE_KEY)) === '1';
}

export interface BackfillResult {
  pages: number;
  scanned: number;
  added: number;
  exhausted: boolean;
}

/**
 * Page backwards through puzzle history until the unreviewed supply reaches
 * `floor` or the history runs out. Safe to call often — it returns immediately
 * when supply is healthy, without touching the network.
 */
export async function backfillPuzzles(
  floor = SUPPLY_FLOOR,
  onProgress?: ProgressFn
): Promise<BackfillResult> {
  const result: BackfillResult = {
    pages: 0,
    scanned: 0,
    added: 0,
    exhausted: await isHistoryExhausted()
  };
  if (result.exhausted) return result;

  for (let page = 0; page < MAX_PAGES; page++) {
    if ((await unreviewedPuzzleCount()) >= floor) break;

    const before = await getMeta(BACKFILL_BEFORE_KEY);
    onProgress?.({ source: 'puzzles', stage: 'fetching', current: result.scanned });

    const { entries, failures } = await fetchPuzzleActivity(
      { max: PAGE_SIZE, before: before ? parseInt(before) : undefined },
      (scanned) =>
        onProgress?.({ source: 'puzzles', stage: 'fetching', current: result.scanned + scanned })
    );

    result.pages++;
    result.scanned += entries.length;
    await setMeta(BACKFILL_AT_KEY, String(Date.now()));

    if (entries.length === 0) {
      await setMeta(BACKFILL_DONE_KEY, '1');
      result.exhausted = true;
      break;
    }

    // `before` is exclusive, so the oldest entry of this page is the next
    // cursor. Written before the inserts: re-running after a failed insert
    // costs a re-fetch, whereas a lost cursor would re-scan from the top.
    await setMeta(BACKFILL_BEFORE_KEY, String(entries[entries.length - 1].date));

    result.added += await storeFailures(failures, false, (done) =>
      onProgress?.({
        source: 'puzzles',
        stage: 'processing',
        current: done,
        total: failures.length
      })
    );

    // A short page means there is nothing older left.
    if (entries.length < PAGE_SIZE) {
      await setMeta(BACKFILL_DONE_KEY, '1');
      result.exhausted = true;
      break;
    }
  }

  onProgress?.({ source: 'puzzles', stage: 'done', current: result.added });
  return result;
}

/**
 * Top up the supply if it has run low. Called on app load, so it is throttled
 * and does nothing at all while supply is healthy.
 */
export async function ensurePuzzleSupply(): Promise<BackfillResult | null> {
  if (await isHistoryExhausted()) return null;
  if ((await unreviewedPuzzleCount()) >= SUPPLY_FLOOR) return null;

  const last = parseInt((await getMeta(BACKFILL_AT_KEY)) ?? '0') || 0;
  if (Date.now() - last < BACKFILL_THROTTLE_MS) return null;

  return backfillPuzzles();
}

// ── Failure count ───────────────────────────────────────────────────────────
const FAILURE_TOTAL_KEY = 'puzzle_failure_total';
const FAILURE_TOTAL_AT_KEY = 'puzzle_failure_total_at';
const FAILURE_TOTAL_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How many puzzles this account has failed on the first attempt, from the
 * dashboard aggregate (`global.nb - global.firstWins`) over a window wide enough
 * to cover any account. One small JSON call instead of scanning every attempt.
 *
 * Cached: it only moves when the user plays puzzles on Lichess.
 */
export async function fetchTotalFailures(force = false): Promise<number | null> {
  const cachedAt = parseInt((await getMeta(FAILURE_TOTAL_AT_KEY)) ?? '0') || 0;
  const cached = await getMeta(FAILURE_TOTAL_KEY);
  if (!force && cached && Date.now() - cachedAt < FAILURE_TOTAL_TTL_MS) {
    return parseInt(cached);
  }

  try {
    const dashboard = await fetchPuzzleDashboard(daysSinceLichessEpoch());
    const total = Math.max(0, dashboard.global.nb - dashboard.global.firstWins);
    await setMeta(FAILURE_TOTAL_KEY, String(total));
    await setMeta(FAILURE_TOTAL_AT_KEY, String(Date.now()));
    return total;
  } catch {
    // Advisory only — a missing count must never block syncing or reviewing.
    return cached ? parseInt(cached) : null;
  }
}

export async function syncAll(onProgress?: ProgressFn): Promise<{
  puzzles: { fetched: number; added: number };
  games: { fetched: number; added: number };
}> {
  const [puzzles, games] = await Promise.all([syncPuzzles(onProgress), syncGames(onProgress)]);
  // Top up from older history if catching up didn't leave enough to study.
  const backfill = await backfillPuzzles(SUPPLY_FLOOR, onProgress);
  puzzles.added += backfill.added;
  // Newly created cards may already have review history pulled from a peer.
  await bindOrphanEvents();
  return { puzzles, games };
}
