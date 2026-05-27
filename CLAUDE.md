# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The `vite` and `svelte-kit` binaries live in `node_modules/.bin/` — the scripts in `package.json` require that path to be on `$PATH`. Use `npx --no-install` or the direct paths if `npm run` fails:

```bash
npm run dev          # dev server on http://localhost:5173
npm run build        # production build → build/
npm run preview      # preview production build
npm run check        # svelte-check type-check (run after svelte-kit sync)
node_modules/.bin/svelte-kit sync   # regenerate .svelte-kit/ (needed after first clone)
node_modules/.bin/vite build        # if npm run build fails due to PATH
```

There are no automated tests yet. Type-checking is the primary correctness gate: `npm run check`.

`better-sqlite3` requires native compilation. After `npm install` on a new machine or Node upgrade, run:
```bash
npm rebuild better-sqlite3
```

## Architecture

**Full-stack SvelteKit app** — one process handles both the Node server (API routes, SQLite, Lichess sync) and serves the Svelte frontend. No separate backend.

### Data flow

```
Lichess API ──► src/lib/server/sync.ts ──► SQLite (data/rookripper.db)
                                                    │
                                          src/lib/server/srs.ts (FSRS scheduling)
                                                    │
src/routes/review/+page.server.ts ◄── getDueCard() ─┘
        │
        ▼
src/routes/review/+page.svelte  (chessground board, puzzle/game move logic)
        │ POST /api/review
        ▼
src/routes/api/review/+server.ts ──► applyReview() ──► SQLite
```

### Server-only modules (`src/lib/server/`)

- **`db.ts`** — SQLite singleton (WAL mode). Runs schema migrations on import. Path controlled by `DATA_DIR` env var (default `./data`). Imported at module load time, so the DB is open for the lifetime of the process.
- **`lichess.ts`** — Typed fetch wrappers for Lichess API. All calls that require auth read the token from the `config` table at call time.
- **`sync.ts`** — `syncPuzzles()` and `syncGames()`. Games sync uses chessops to replay moves from the starting position in order to extract FEN-before-blunder and convert SAN→UCI. The `since` cursor for each sync type is stored in the `config` table.
- **`srs.ts`** — Thin wrapper around `ts-fsrs`. `getDueCard(source?)` is the primary read (optional `'puzzle'|'game'` filter); `applyReview()` is the primary write (transactional: updates card + inserts review_log row). Enforces a daily new-card limit stored in the `config` table under `new_cards_per_day` (default 20; 0 = unlimited). A one-time daily override is stored in `extra_new_today` as `"YYYY-MM-DD:N"`.

### Card types

Two card sources share one `cards` table and one review flow. Differences:

| | Puzzle | Game |
|---|---|---|
| Solution | `solution_moves` JSON array (UCI), multi-move | Single best move in `best_move` (UCI) |
| Correctness check | Exact match against solution sequence | Exact match OR cloud eval within 50cp |
| Data source | `/api/puzzle/activity` (win=false) | Game PGN analysis, Blunder/Mistake only |

### Review page state machine (`src/routes/review/+page.svelte`)

Phases: `playing → evaluating → complete` (wrong moves loop back to `playing`).

For puzzles: user plays even-indexed solution moves (0, 2, 4…); the computer's odd-indexed responses are auto-applied with a 350ms delay.

For game cards: if the user plays a non-best move, `POST /api/cloud-eval` is called server-side, which makes two Lichess cloud-eval calls (original FEN + FEN after user's move) and returns `{ accepted, centipawn_loss }`. The 50cp threshold is the constant `GOOD_ENOUGH_CP` in `src/routes/api/cloud-eval/+server.ts`.

The review route accepts a `?source=puzzle|game` query param (set via the source-filter dropdown in the nav) that is forwarded to `getDueCard()`.

### Settings

**Client-side settings** (`src/lib/settings.ts`) are stored in `localStorage` under `rookripper_settings`. Defaults live in `DEFAULTS`. `loadSettings()` / `saveSettings()` are the access points; reads return a merged copy so missing keys fall back to defaults. The settings page (`/settings`, CSR-only via `ssr = false`) writes on every input event — no submit button.

**Server-side settings** are stored in the `config` table:

| Key | Default | Purpose |
|---|---|---|
| `new_cards_per_day` | `20` | Daily new-card cap (0 = unlimited). Read/written by `GET /PATCH /api/settings`. |
| `extra_new_today` | — | One-time daily override in `"YYYY-MM-DD:N"` format. Incremented by 20 each time the "+ 20 more new" button is pressed (`POST /api/inject-new`). Stale entries (different date) are ignored. |

### Dashboard (`src/routes/+page.svelte`)

In addition to due-card counts and sync history, the dashboard now shows:
- **New today** progress row (`newToday / dailyLimit + extraToday`) with a "+ 20 more new" button (calls `POST /api/inject-new`).
- **Card breakdown** table — counts by `source × state` (new / learning / review / relearning).
- **30-day review forecast** — bar chart of scheduled non-new cards per calendar day, sourced from the `dailyForecast` array returned by the server load.

### Key environment variables

| Var | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `./data` | SQLite file location |
| `ORIGIN` | — | **Required** in production — the app's base URL (SvelteKit requirement) |
| `PORT` | `3000` | Server listen port |

Docker: the compose file maps host port **3999** → container 3000. Update `ORIGIN` in `docker-compose.yml` before deploying to a homelab hostname.

### Lichess API notes

- Auth: personal access token (PAT) stored in `config` table, scope `puzzle:read`. Public game endpoints need no scope.
- Puzzle activity endpoint returns ndjson sorted newest-first; `since` param filters by timestamp.
- Game export: `?analyzed=true&evals=true` returns JSON analysis array indexed per half-move. `analysis[i].best` is UCI; moves string is SAN.
- Cloud eval (`/api/cloud-eval`) returns 404 when the position isn't in the database — the review route handles this gracefully by requiring the exact best move as fallback.
- Storm/Streak: no per-puzzle failure data available via API; excluded from scope.
