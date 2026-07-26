import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RawPuzzleActivity, PuzzleActivityPage } from '$lib/lichess';
import { DAY } from './helpers';

// A stand-in for /api/puzzle/activity: a fixed history, newest first, served
// through the same max/before paging the real endpoint documents.
const lichess = {
  history: [] as RawPuzzleActivity[],
  requests: [] as Array<{ max?: number; before?: number; since?: number }>,
  dashboard: { nb: 0, firstWins: 0 },
  reset() {
    this.history = [];
    this.requests = [];
    this.dashboard = { nb: 0, firstWins: 0 };
  }
};

function entry(id: string, date: number, win: boolean): RawPuzzleActivity {
  return {
    date,
    win,
    puzzle: {
      id,
      rating: 1500,
      plays: 100,
      solution: ['e2e4', 'e7e5'],
      themes: ['fork'],
      fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
      lastMove: 'a1a2'
    }
  };
}

vi.mock('$lib/lichess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/lichess')>();
  return {
    ...actual,
    fetchAnalyzedGames: async () => [],
    fetchPuzzleDashboard: async (days: number) => ({
      days,
      global: {
        nb: lichess.dashboard.nb,
        firstWins: lichess.dashboard.firstWins,
        replayWins: 0,
        puzzleRatingAvg: 1500,
        performance: 1500
      },
      themes: {}
    }),
    fetchPuzzleActivity: async (
      opts: { max?: number; before?: number; since?: number } = {}
    ): Promise<PuzzleActivityPage> => {
      lichess.requests.push(opts);
      let rows = [...lichess.history].sort((a, b) => b.date - a.date);
      if (opts.before) rows = rows.filter((r) => r.date < opts.before!);
      if (opts.since) rows = rows.filter((r) => r.date > opts.since!);
      if (opts.max) rows = rows.slice(0, opts.max);
      return { entries: rows, failures: rows.filter((r) => !r.win) };
    }
  };
});

const { backfillPuzzles, ensurePuzzleSupply, syncPuzzles, unreviewedPuzzleCount, fetchTotalFailures } =
  await import('$lib/sync');
const { db, getMeta, setMeta } = await import('$lib/db');
const { applyReview } = await import('$lib/srs');
const { resetDb } = await import('./helpers');

/** `count` attempts going back one hour apart, every `failEvery`-th a loss. */
function buildHistory(count: number, failEvery: number, start = Date.now()): void {
  lichess.history = Array.from({ length: count }, (_, i) =>
    entry(`pz${i}`, start - i * 3_600_000, i % failEvery !== 0)
  );
}

describe('puzzle backfill', () => {
  beforeEach(async () => {
    await resetDb();
    lichess.reset();
  });

  it('takes only the newest page on a first sync instead of the whole history', async () => {
    buildHistory(1000, 3);
    await syncPuzzles();

    expect(lichess.requests).toHaveLength(1);
    expect(lichess.requests[0].max).toBe(200);
    expect(lichess.requests[0].since).toBeUndefined();

    // Only failures from that page became cards, not all 1000 entries.
    const cards = await db.cards.count();
    expect(cards).toBeGreaterThan(0);
    expect(cards).toBeLessThan(200);
    expect(await getMeta('puzzle_backfill_before')).toBeDefined();
  });

  it('pages backwards until the supply floor is met', async () => {
    buildHistory(2000, 20, Date.now()); // only 5% failures — needs several pages
    await syncPuzzles();

    const before = await unreviewedPuzzleCount();
    const result = await backfillPuzzles(60);

    expect(result.pages).toBeGreaterThan(1);
    expect(await unreviewedPuzzleCount()).toBeGreaterThanOrEqual(60);
    expect(await unreviewedPuzzleCount()).toBeGreaterThan(before);

    // Every page after the first carried a `before` cursor that moved backwards.
    const cursors = lichess.requests.filter((r) => r.before).map((r) => r.before!);
    expect(cursors.length).toBeGreaterThan(0);
    for (let i = 1; i < cursors.length; i++) expect(cursors[i]).toBeLessThan(cursors[i - 1]);
  });

  it('marks the history exhausted at the end and stops asking', async () => {
    buildHistory(120, 2);
    await syncPuzzles();
    await backfillPuzzles(1000);

    expect(await getMeta('puzzle_history_exhausted')).toBe('1');

    const requestsBefore = lichess.requests.length;
    const again = await backfillPuzzles(1000);
    expect(again.pages).toBe(0);
    expect(again.exhausted).toBe(true);
    expect(lichess.requests).toHaveLength(requestsBefore);
  });

  it('does not touch the network while supply is healthy', async () => {
    buildHistory(500, 2);
    await syncPuzzles();
    expect(await unreviewedPuzzleCount()).toBeGreaterThanOrEqual(60);

    const requestsBefore = lichess.requests.length;
    expect(await ensurePuzzleSupply()).toBeNull();
    expect(lichess.requests).toHaveLength(requestsBefore);
  });

  it('tops up once the supply drops below the floor', async () => {
    buildHistory(2000, 2);
    await syncPuzzles();

    // Study everything currently loaded, so nothing unreviewed is left.
    for (const card of await db.cards.toArray()) {
      await applyReview(card.id!, 3, null, true, null, null, Date.now());
    }
    expect(await unreviewedPuzzleCount()).toBe(0);

    const result = await ensurePuzzleSupply();
    expect(result).not.toBeNull();
    expect(await unreviewedPuzzleCount()).toBeGreaterThanOrEqual(60);
  });

  it('never resets a studied card when backfilling older history', async () => {
    const now = Date.now();
    // The same puzzle failed twice: recently, and again long ago.
    lichess.history = [
      entry('repeat', now - 3_600_000, false),
      ...Array.from({ length: 210 }, (_, i) => entry(`filler${i}`, now - (i + 2) * 3_600_000, true)),
      entry('repeat', now - 400 * 3_600_000, false)
    ];

    await syncPuzzles();
    const card = (await db.cards.where('lichess_puzzle_id').equals('repeat').first())!;
    await applyReview(card.id!, 3, null, true, null, null, now);

    const studied = (await db.cards.get(card.id!))!;
    expect(studied.reps).toBe(1);

    await backfillPuzzles(1000);

    // The older failure must not have reset the live schedule.
    const after = (await db.cards.get(card.id!))!;
    expect(after.reps).toBe(1);
    expect(after.state).not.toBe('new');
    expect(after.due).toBe(studied.due);
    expect(after.original_failure_at).toBe(studied.original_failure_at);
  });

  it('still resets a card when the puzzle is failed again more recently', async () => {
    const now = Date.now();
    lichess.history = [entry('again', now - 10 * DAY, false)];
    await syncPuzzles();

    const card = (await db.cards.where('lichess_puzzle_id').equals('again').first())!;
    await applyReview(card.id!, 4, null, true, null, null, now - 9 * DAY);
    expect((await db.cards.get(card.id!))!.state).not.toBe('new');

    // Failed again on Lichess since the last sync.
    lichess.history = [entry('again', now, false), ...lichess.history];
    await syncPuzzles();

    const after = (await db.cards.get(card.id!))!;
    expect(after.state).toBe('new');
    expect(after.reps).toBe(0);
  });

  it('derives the total failure count from the dashboard aggregate', async () => {
    lichess.dashboard = { nb: 4210, firstWins: 3105 };
    expect(await fetchTotalFailures()).toBe(1105);
    expect(await getMeta('puzzle_failure_total')).toBe('1105');

    // Cached: a changed dashboard is not re-read within the TTL.
    lichess.dashboard = { nb: 9999, firstWins: 0 };
    expect(await fetchTotalFailures()).toBe(1105);
    expect(await fetchTotalFailures(true)).toBe(9999);
  });

  it('falls back to the cached count when Lichess is unreachable', async () => {
    await setMeta('puzzle_failure_total', '777');
    await setMeta('puzzle_failure_total_at', '0');
    lichess.dashboard = null as unknown as { nb: number; firstWins: number };
    expect(await fetchTotalFailures()).toBe(777);
  });
});
