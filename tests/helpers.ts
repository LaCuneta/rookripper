import { db } from '$lib/db';
import { resetDeviceIdCache } from '$lib/device';
import type { Card } from '$lib/types';

/** Deterministic PRNG so a failing history is reproducible from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function resetDb(): Promise<void> {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.cards.clear(), db.reviewLog.clear(), db.meta.clear(), db.syncLog.clear()]);
  resetDeviceIdCache();
}

export function blankCard(at: number): Omit<Card, 'id'> {
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
    due: at,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    last_reviewed_at: null,
    original_failure_at: null,
    added_at: at
  };
}

export async function addPuzzleCard(id: string, at: number, failedAt = at): Promise<number> {
  return db.cards.add({
    ...blankCard(at),
    source: 'puzzle',
    lichess_puzzle_id: id,
    original_failure_at: failedAt
  } as Card);
}

export async function addGameCard(gameId: string, move: number, at: number): Promise<number> {
  return db.cards.add({
    ...blankCard(at),
    source: 'game',
    lichess_game_id: gameId,
    game_move_number: move
  } as Card);
}

export const DAY = 86_400_000;
