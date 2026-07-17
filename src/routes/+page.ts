import type { PageLoad } from './$types';
import { db, getMeta } from '$lib/db';
import { getDueStats, getNewCardInfo } from '$lib/srs';

// Local YYYY-MM-DD key, matching the client-side dateKey() in +page.svelte so
// the forecast buckets line up with the rendered day rows.
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const load: PageLoad = async () => {
  const stats = await getDueStats();
  const { dailyLimit, extraToday, usedToday } = await getNewCardInfo();

  const recentSyncs = (
    await db.syncLog.orderBy('started_at').reverse().limit(6).toArray()
  ).map((s) => ({
    sync_type: s.sync_type,
    completed_at: s.completed_at,
    items_added: s.items_added,
    error: s.error
  }));

  const puzzleCursor = await getMeta('last_puzzle_sync');
  const gameCursor = await getMeta('last_game_sync');

  // One scan of all cards feeds both the breakdown and the forecast.
  const allCards = await db.cards.toArray();

  const breakdown = new Map<string, number>();
  const now = Date.now();
  const in30Days = now + 30 * 24 * 60 * 60 * 1000;
  const forecast = new Map<string, number>();

  for (const c of allCards) {
    const key = `${c.source}|${c.state}`;
    breakdown.set(key, (breakdown.get(key) ?? 0) + 1);

    if (c.state !== 'new' && c.due >= now && c.due <= in30Days) {
      const day = localDateKey(new Date(c.due));
      forecast.set(day, (forecast.get(day) ?? 0) + 1);
    }
  }

  const cardBreakdown = [...breakdown.entries()].map(([k, n]) => {
    const [source, state] = k.split('|');
    return { source, state, n };
  });

  const dailyForecast = [...forecast.entries()]
    .map(([day, n]) => ({ day, n }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    stats,
    recentSyncs,
    lastPuzzleSync: puzzleCursor ? parseInt(puzzleCursor) : null,
    lastGameSync: gameCursor ? parseInt(gameCursor) : null,
    cardBreakdown,
    dailyForecast,
    newToday: usedToday,
    dailyLimit,
    extraToday
  };
};
