import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncPuzzles, syncGames } from '$lib/server/sync';

export const POST: RequestHandler = async () => {
  try {
    const [puzzles, games] = await Promise.all([syncPuzzles(), syncGames()]);
    return json({ puzzles, games });
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
