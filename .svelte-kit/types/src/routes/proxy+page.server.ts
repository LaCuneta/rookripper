// @ts-nocheck
import type { PageServerLoad } from './$types';
import db from '$lib/server/db';
import { getDueStats } from '$lib/server/srs';

export const load = async () => {
  const stats = getDueStats();

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

  return {
    stats,
    recentSyncs,
    lastPuzzleSync: lastPuzzleSync ? parseInt(lastPuzzleSync.value) : null,
    lastGameSync: lastGameSync ? parseInt(lastGameSync.value) : null
  };
};
;null as any as PageServerLoad;