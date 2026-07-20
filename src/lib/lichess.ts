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

export async function fetchPuzzleFailures(
  since?: number,
  onScan?: (scanned: number) => void
): Promise<RawPuzzleActivity[]> {
  const params = new URLSearchParams();
  if (since) params.set('since', String(since));

  const entries = await fetchNdjson<RawPuzzleActivity>(
    `${BASE}/api/puzzle/activity?${params}`,
    { headers: await authHeaders() },
    'Puzzle activity',
    (_item, scanned) => onScan?.(scanned)
  );

  return entries.filter((e) => !e.win);
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
