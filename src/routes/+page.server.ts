import type { PageServerLoad } from './$types';
import db from '$lib/server/db';
import { getDueStats } from '$lib/server/srs';

export const load: PageServerLoad = async () => {
  const stats = getDueStats();

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startOfDay = today.getTime();
  const dateStr = today.toISOString().slice(0, 10);

  const limitRow = db.prepare("SELECT value FROM config WHERE key = 'new_cards_per_day'").get() as { value: string } | undefined;
  const dailyLimit = limitRow ? parseInt(limitRow.value) : 20;

  const extraRow = db.prepare("SELECT value FROM config WHERE key = 'extra_new_today'").get() as { value: string } | undefined;
  let extraToday = 0;
  if (extraRow) {
    const [d, n] = extraRow.value.split(':');
    if (d === dateStr) extraToday = parseInt(n) || 0;
  }

  const newToday = (db
    .prepare("SELECT COUNT(*) as n FROM cards WHERE reps = 1 AND last_reviewed_at >= ?")
    .get(startOfDay) as { n: number }).n;

  const recentSyncs = db
    .prepare(
      `SELECT sync_type, completed_at, items_added, error
       FROM sync_log
       ORDER BY started_at DESC
       LIMIT 6`
    )
    .all() as Array<{
    sync_type: string;
    completed_at: number | null;
    items_added: number | null;
    error: string | null;
  }>;

  const lastPuzzleSync = db
    .prepare("SELECT value FROM config WHERE key = 'last_puzzle_sync'")
    .get() as { value: string } | undefined;

  const lastGameSync = db
    .prepare("SELECT value FROM config WHERE key = 'last_game_sync'")
    .get() as { value: string } | undefined;

  // Card counts broken down by source × state
  const cardBreakdown = db
    .prepare(
      `SELECT source, state, COUNT(*) as n
       FROM cards
       GROUP BY source, state`
    )
    .all() as Array<{ source: string; state: string; n: number }>;

  // Per-day scheduled review counts for the next 30 calendar days.
  // Excludes 'new' cards — those are all due immediately and counted separately as backlog.
  // 30 days (not 14) because Easy-rated first reviews land ~16 days out in FSRS defaults.
  const now = Date.now();
  const in30Days = now + 30 * 24 * 60 * 60 * 1000;
  const dailyForecast = db
    .prepare(
      `SELECT date(due / 1000, 'unixepoch', 'localtime') as day, COUNT(*) as n
       FROM cards
       WHERE state != 'new' AND due BETWEEN ? AND ?
       GROUP BY day
       ORDER BY day`
    )
    .all(now, in30Days) as Array<{ day: string; n: number }>;

  return {
    stats,
    recentSyncs,
    lastPuzzleSync: lastPuzzleSync ? parseInt(lastPuzzleSync.value) : null,
    lastGameSync: lastGameSync ? parseInt(lastGameSync.value) : null,
    cardBreakdown,
    dailyForecast,
    newToday,
    dailyLimit,
    extraToday,
  };
};
