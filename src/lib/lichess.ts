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

export async function fetchPuzzleFailures(since?: number): Promise<RawPuzzleActivity[]> {
  const params = new URLSearchParams();
  if (since) params.set('since', String(since));

  const res = await fetch(`${BASE}/api/puzzle/activity?${params}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Puzzle activity: ${res.status}`);

  const text = await res.text();
  const entries: RawPuzzleActivity[] = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  return entries.filter((e) => !e.win);
}

export async function fetchAnalyzedGames(username: string, since?: number): Promise<RawGame[]> {
  const params = new URLSearchParams({
    analyzed: 'true',
    evals: 'true',
    moves: 'true',
    clocks: 'false',
    opening: 'false',
    max: '200'
  });
  if (since) params.set('since', String(since));

  const res = await fetch(`${BASE}/api/games/user/${encodeURIComponent(username)}?${params}`, {
    headers: { ...(await authHeaders()), Accept: 'application/x-ndjson' }
  });
  if (!res.ok) throw new Error(`Games fetch: ${res.status}`);

  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
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
