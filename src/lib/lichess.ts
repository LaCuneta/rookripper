import { getMeta } from './db';

// Browser-side Lichess API wrappers. Formerly src/lib/server/lichess.ts —
// the only change is that the token comes from Dexie meta instead of the
// server config table, and calls run directly from the browser (Lichess sets
// permissive CORS on these read endpoints).
const BASE = 'https://lichess.org';

async function authHeaders(): Promise<HeadersInit> {
  const token = await getMeta('access_token');
  if (!token) throw new Error('Not connected to Lichess.');
  return { Authorization: `Bearer ${token}` };
}

export async function getUsername(): Promise<string> {
  const res = await fetch(`${BASE}/api/account`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Account fetch failed: ${res.status}`);
  const data = await res.json();
  return data.username as string;
}

export async function revokeToken(): Promise<void> {
  await fetch(`${BASE}/api/token`, { method: 'DELETE', headers: await authHeaders() });
}

// Both list endpoints return ndjson with no up-front count, so we read the body
// incrementally and surface a running tally rather than buffering the whole
// response — that's what makes a live progress meter possible.
async function fetchNdjson<T>(
  url: string,
  init: RequestInit,
  label: string,
  onItem?: (item: T, scanned: number) => void
): Promise<T[]> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${label}: ${res.status}`);

  const items: T[] = [];
  const push = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const item = JSON.parse(trimmed) as T;
    items.push(item);
    onItem?.(item, items.length);
  };

  if (!res.body) {
    (await res.text()).split('\n').forEach(push);
    return items;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      push(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  push(buf);
  return items;
}

export interface PuzzleActivityPage {
  /** Every entry scanned, newest first — wins included. */
  entries: RawPuzzleActivity[];
  /** Just the losses: the only entries that become cards. */
  failures: RawPuzzleActivity[];
}

/**
 * A window of puzzle activity. The endpoint returns *every* attempt, wins
 * included, each carrying a full puzzle object, so an unbounded call downloads
 * far more than it keeps — hence `max`/`before` paging rather than one big pull.
 * Lichess documents that pair explicitly for pagination.
 */
export async function fetchPuzzleActivity(
  opts: { max?: number; before?: number; since?: number } = {},
  onScan?: (scanned: number) => void
): Promise<PuzzleActivityPage> {
  const params = new URLSearchParams();
  if (opts.max) params.set('max', String(opts.max));
  if (opts.before) params.set('before', String(opts.before));
  if (opts.since) params.set('since', String(opts.since));

  const entries = await fetchNdjson<RawPuzzleActivity>(
    `${BASE}/api/puzzle/activity?${params}`,
    { headers: await authHeaders() },
    'Puzzle activity',
    (_item, scanned) => onScan?.(scanned)
  );

  return { entries, failures: entries.filter((e) => !e.win) };
}

// Lichess predates any user account, so a window this wide is effectively
// "lifetime" for the dashboard aggregate. `days` has a documented minimum of 1
// and no maximum.
const LICHESS_EPOCH = Date.UTC(2010, 0, 1);

export function daysSinceLichessEpoch(): number {
  return Math.ceil((Date.now() - LICHESS_EPOCH) / 86_400_000);
}

/**
 * Aggregate puzzle results over the last `days`. `global.nb - global.firstWins`
 * is the number of puzzles failed on the first attempt — the closest thing the
 * API offers to a total failure count, and one small JSON call rather than a
 * full scan of the activity stream.
 */
export async function fetchPuzzleDashboard(days: number): Promise<PuzzleDashboard> {
  const res = await fetch(`${BASE}/api/puzzle/dashboard/${days}`, {
    headers: await authHeaders()
  });
  if (!res.ok) throw new Error(`Puzzle dashboard: ${res.status}`);
  return res.json();
}

export async function fetchAnalyzedGames(
  username: string,
  since?: number,
  onScan?: (scanned: number) => void
): Promise<RawGame[]> {
  const params = new URLSearchParams({
    analyzed: 'true',
    evals: 'true',
    moves: 'true',
    clocks: 'false',
    opening: 'false',
    max: '200'
  });
  if (since) params.set('since', String(since));

  return fetchNdjson<RawGame>(
    `${BASE}/api/games/user/${encodeURIComponent(username)}?${params}`,
    { headers: { ...(await authHeaders()), Accept: 'application/x-ndjson' } },
    'Games fetch',
    (_item, scanned) => onScan?.(scanned)
  );
}

export async function cloudEval(fen: string, multiPv = 3): Promise<CloudEvalResult | null> {
  const params = new URLSearchParams({ fen, multiPv: String(multiPv) });
  const res = await fetch(`${BASE}/api/cloud-eval?${params}`);
  if (res.status === 404) return null; // position not in cloud DB
  if (!res.ok) throw new Error(`Cloud eval: ${res.status}`);
  return res.json();
}

// ── Raw API response shapes ──────────────────────────────────────────────────

export interface RawPuzzleActivity {
  date: number;
  win: boolean;
  puzzle: {
    id: string;
    rating: number;
    plays: number;
    solution: string[];
    themes: string | string[];
    fen: string;
    lastMove: string;
  };
}

export interface PuzzlePerformance {
  nb: number;
  firstWins: number;
  replayWins: number;
  puzzleRatingAvg: number;
  performance: number;
}

export interface PuzzleDashboard {
  days: number;
  global: PuzzlePerformance;
  themes: Record<string, { theme: string; results: PuzzlePerformance }>;
}

export interface RawGame {
  id: string;
  players: {
    white: { user?: { name: string }; rating?: number };
    black: { user?: { name: string }; rating?: number };
  };
  moves: string;
  analysis?: Array<{
    eval?: number;
    mate?: number;
    best?: string;
    variation?: string;
    judgment?: {
      name: 'Inaccuracy' | 'Mistake' | 'Blunder';
      comment: string;
    };
  }>;
}

export interface CloudEvalResult {
  fen: string;
  knodes: number;
  depth: number;
  pvs: Array<{
    moves: string;
    cp?: number;
    mate?: number;
  }>;
}
