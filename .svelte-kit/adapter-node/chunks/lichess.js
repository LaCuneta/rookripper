import { d as db } from "./db.js";
const BASE = "https://lichess.org";
function token() {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get("access_token");
  if (!row) throw new Error("No access token configured");
  return row.value;
}
function auth() {
  return { Authorization: `Bearer ${token()}` };
}
async function getUsername() {
  const res = await fetch(`${BASE}/api/account`, { headers: auth() });
  if (!res.ok) throw new Error(`Account fetch failed: ${res.status}`);
  const data = await res.json();
  return data.username;
}
async function fetchPuzzleFailures(since) {
  const params = new URLSearchParams();
  if (since) params.set("since", String(since));
  const res = await fetch(`${BASE}/api/puzzle/activity?${params}`, { headers: auth() });
  if (!res.ok) throw new Error(`Puzzle activity: ${res.status}`);
  const text = await res.text();
  const entries = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return entries.filter((e) => !e.win);
}
async function fetchAnalyzedGames(username, since) {
  const params = new URLSearchParams({
    analyzed: "true",
    evals: "true",
    moves: "true",
    clocks: "false",
    opening: "false",
    max: "200"
  });
  if (since) params.set("since", String(since));
  const res = await fetch(`${BASE}/api/games/user/${encodeURIComponent(username)}?${params}`, {
    headers: { ...auth(), Accept: "application/x-ndjson" }
  });
  if (!res.ok) throw new Error(`Games fetch: ${res.status}`);
  const text = await res.text();
  return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
async function cloudEval(fen, multiPv = 3) {
  const params = new URLSearchParams({ fen, multiPv: String(multiPv) });
  const res = await fetch(`${BASE}/api/cloud-eval?${params}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cloud eval: ${res.status}`);
  return res.json();
}
export {
  fetchPuzzleFailures as a,
  cloudEval as c,
  fetchAnalyzedGames as f,
  getUsername as g
};
