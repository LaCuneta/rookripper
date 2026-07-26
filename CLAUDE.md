# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The `vite` and `svelte-kit` binaries live in `node_modules/.bin/` — the scripts in `package.json` require that path to be on `$PATH`. Use `npx --no-install` or the direct paths if `npm run` fails:

```bash
npm run dev          # dev server on http://localhost:5173
npm run build        # static production build → build/ (SPA)
npm run preview      # preview production build
npm run check        # svelte-check type-check (run after svelte-kit sync)
npm test             # vitest (tests/) — SRS replay, merge, migration
npm run test:watch   # vitest in watch mode
node_modules/.bin/svelte-kit sync   # regenerate .svelte-kit/ (needed after first clone)
node_modules/.bin/vite build        # if npm run build fails due to PATH
```

Tests (`tests/`) run under vitest against a real Dexie database backed by
`fake-indexeddb`, so they exercise the production code paths rather than mocks.
UI components are not tested; type-checking (`npm run check`) remains the gate
there.

The **replay-fidelity test** (`tests/replay.test.ts`) is the important one: it
simulates months of study through the real `applyReview()` and asserts that
replaying the resulting `reviewLog` reproduces the stored card state exactly.
Cross-device sync depends on that equality, so this test gates any change to
scheduling, and `ts-fsrs` should not be upgraded without re-running it.

## Architecture

**Fully client-side SvelteKit SPA.** There is no server: `adapter-static` emits a
static bundle (`build/`, with a `200.html` fallback), `ssr = false` in the root
`+layout.ts` makes every route CSR-only, and all data lives in the browser
(IndexedDB via Dexie). The app talks to Lichess directly from the browser.

### Data flow

```
Lichess API ──► src/lib/sync.ts ──► IndexedDB / Dexie (src/lib/db.ts)
                                              │
                                    src/lib/srs.ts (FSRS scheduling)
                                              │
src/routes/review/+page.ts ◄── getDueCard() ──┘   (client load)
        │
        ▼
src/routes/review/+page.svelte  (chessground board, puzzle/game move logic)
        │ applyReview()  /  evaluateMove()
        ▼
      Dexie
```

### Client modules (`src/lib/`)

- **`db.ts`** — Dexie database singleton. Tables `cards`, `reviewLog`, `meta`
  (key/value config), `syncLog`. Schema mirrors the former SQLite tables so
  exports round-trip. Exports `getMeta`/`setMeta`/`deleteMeta` and
  `requestPersistentStorage()` (`navigator.storage.persist()`).
- **`oauth.ts`** — Lichess OAuth 2.0 **PKCE** flow (public client, no secret, no
  backend). `beginLogin()` redirects to Lichess; `completeLogin(url)` exchanges
  the code and stores the token + username in `meta`. `client_id`/`redirect_uri`
  derive from `window.location.origin + base` so it works on localhost and a
  future github.io subpath unchanged.
- **`lichess.ts`** — Browser fetch wrappers for the Lichess API. Auth calls read
  the token from Dexie `meta` at call time.
- **`sync.ts`** — `syncPuzzles()`, `syncGames()`, `syncAll()`. Games sync uses
  chessops (browser-safe) to replay moves from the start position to extract
  FEN-before-blunder and convert SAN→UCI. `since` cursors are stored in `meta`.
- **`srs.ts`** — Wrapper around `ts-fsrs` (pure JS, runs unchanged in the
  browser). `getDueCard(source?)` is the primary read; `applyReview()` is the
  primary write (Dexie transaction: updates card + adds a reviewLog row). Daily
  new-card limit lives in `meta.new_cards_per_day` (default 20; 0 = unlimited);
  `injectExtraNew()` bumps the one-time override in `meta.extra_new_today`.
- **`cloudEval.ts`** — `evaluateMove(fen, move)`: two direct Lichess cloud-eval
  calls (original FEN + FEN after the move), returns `{ accepted, centipawn_loss,
  reason }`. `GOOD_ENOUGH_CP = 50`.
- **`export.ts`** — `exportData()`/`importData()` + browser download/read
  helpers. Backup JSON is `{ version, app, exportedAt, cards, reviewLog, meta }`
  (SRS state only — never the access token). Matches `scripts/dump-sql-to-json.mjs`.

### Migrating legacy SQLite progress

`scripts/dump-sql-to-json.mjs` reads a legacy `data/rookripper.db` (via
`better-sqlite3`, which is no longer a project dependency — install it ad hoc to
run the script) and writes a backup JSON in the format `importData()` accepts.
Import it from the dashboard's **Data & backup** section.

### Puzzle supply (incremental history load)

`/api/puzzle/activity` streams **every** attempt ever made — wins included, each
carrying a full puzzle object — so pulling a long history up front was the
slowest part of connecting. Instead:

- `syncPuzzles()` catches up **forwards** from the `last_puzzle_sync` cursor. On
  a first run (no cursor) it takes only the newest page (`max=200`).
- `backfillPuzzles(floor)` pages **backwards** via `before` + `max` (Lichess
  documents that pair for pagination), stopping once unreviewed puzzle cards
  reach `SUPPLY_FLOOR` (60, ~3 days at the default 20/day) or the history runs
  out. `MAX_PAGES` caps a single top-up.
- `ensurePuzzleSupply()` runs on app load: a local count first, so it makes no
  network call while supply is healthy, and it's throttled besides.

**Direction of travel decides whether a card resets.** Forwards, a puzzle we
already hold turning up again means a *re-failure* — reset it to `new`.
Backwards, older failures say nothing new, so existing cards are left alone;
resetting there would wipe a live schedule with stale history. That's the
`resetExisting` flag on `storeFailures()`.

`puzzle_backfill_before` / `puzzle_history_exhausted` are **deliberately not
synced**: they describe how much history *this device* has pulled into its local
`cards` table, and adopting a peer's deeper cursor would make a device skip the
range in between and never create those cards.

`fetchTotalFailures()` gets an advisory total from
`/api/puzzle/dashboard/{days}` — `global.nb - global.firstWins` is the
first-attempt failure count. `days` has no documented maximum, so a window
spanning Lichess's whole existence gives a lifetime figure in one small JSON
call. Cached for 6h and never allowed to block sync or review.

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

For game cards: a non-best move calls `evaluateMove()` (`src/lib/cloudEval.ts`),
which makes two Lichess cloud-eval calls and accepts moves within the 50cp
`GOOD_ENOUGH_CP` threshold.

The review route accepts a `?source=puzzle|game` query param (set via the source-filter dropdown in the nav) that is forwarded to `getDueCard()`.

Promotion: a pawn reaching the far rank opens a picker overlay
(`promoChoices`) and the move is held until the user chooses; the resulting
UCI carries the piece suffix. Puzzle solutions are matched **exactly**,
including that suffix — underpromotion is frequently the point of the puzzle,
so a queen must not satisfy a solution requiring a knight.

### Board rendering (`src/lib/components/ChessBoard.svelte`)

chessground paints squares as a `background-color` plus a translucent SVG
overlay, so board colours are overridable in pure CSS. `BOARD_THEMES` in
`settings.ts` holds the light/dark pairs and the component renders a
`conic-gradient` checkerboard: one tile spans 2×2 squares, so `background-size:
25%` tiles to exactly 8×8 with the light square on a8. The tile is symmetric,
so flipping orientation stays correct.

**Piece sets are deliberately not implemented.** chessground ships only
cburnett; Lichess's other sets are separately-licensed SVG assets that would
have to be vendored and license-reviewed individually. Reading the user's
actual Lichess board/piece preference is also out of scope: `/api/account/
preferences` needs the `preference:read` scope (forcing every existing user to
re-authorize) and returns only a *theme name*, which is useless without those
same assets. Lichess's textured themes (wood, canvas, marble) are images and
likewise aren't offered.

### Sound (`src/lib/sound.ts`)

`playMove()`, `playCapture()`, `playWrong()` are **synthesised with the Web Audio
API** — no audio files. Lichess's samples are separately-licensed assets, and
synthesis keeps the bundle asset-free and offline-capable, at the cost of being
close-but-not-identical to Lichess. Moves are a filtered-noise transient plus a
low sine body; captures are the same, heavier and lower; the wrong-move sound is
a soft tremolo'd triangle, deliberately not an error klaxon.

The `AudioContext` is created lazily and resumed on use — every caller runs from
a click or drag, satisfying autoplay policy. Sound is gated on the `sound`
setting, and all three are previewable from the settings page.

Capture detection lives in the review page's `isCapture()`, which checks the
destination square in the pre-move position and handles en passant (a pawn
changing file onto an empty square).

### Settings

**Client-side UI settings** (`src/lib/settings.ts`) are stored in `localStorage`
under `rookripper_settings`. Defaults live in `DEFAULTS`. `loadSettings()` /
`saveSettings()` are the access points; reads return a merged copy so missing
keys fall back to defaults. The settings page writes on every input event.

**Scheduling config** lives in the Dexie `meta` table:

| Key | Default | Purpose |
|---|---|---|
| `new_cards_per_day` | `20` | Daily new-card cap (0 = unlimited). Read/written by the settings page. |
| `extra_new_today` | — | One-time daily override in `"YYYY-MM-DD:N"` format. `injectExtraNew()` bumps it by 20 (the "+ 20 more new" button). Stale entries (different date) are ignored. |
| `access_token`, `lichess_username` | — | Set by the OAuth flow. Never exported. |
| `last_puzzle_sync`, `last_game_sync` | — | Sync cursors. |

### Dashboard (`src/routes/+page.svelte`)

Client `+page.ts` load computes everything from Dexie. The dashboard shows:
- **New today** progress row with a "+ 20 more new" button (`injectExtraNew()`).
- **Card breakdown** table — counts by `source × state`.
- **30-day review forecast** — bar chart of scheduled non-new cards per calendar day.
- **Data & backup** — export/import of SRS state, with a durability warning.

### Cross-device sync (Google Drive)

Serverless sync of review progress through the Drive **appData** folder — a
hidden per-app space the user's other apps can't see. Design doc: `GDRIVE_PLAN.md`.

**Only review events sync.** Lichess is the source of truth for puzzle/game
content, which is large and re-fetchable, so no FEN/PGN/solution ever leaves the
device. `cards` is a **local projection**: every device rebuilds it by replaying
the merged event log, because FSRS scheduling is a deterministic fold over
`(rating, timestamp)` pairs. Neither access token is ever written to the file.

| Module | Role |
|---|---|
| `googleAuth.ts` | GIS token flow (popup, no secret, no redirect URI). Scope `drive.appdata` only — classified non-sensitive, so publishing needs no verification review. Silent re-issue via `prompt: ''`. |
| `drive.ts` | appData REST: find / download / resumable upload / delete. |
| `syncFile.ts` | The wire format, `mergeSyncFile()`, and `reconcileMeta()`. |
| `driveSync.ts` | Orchestration: pull, push, batched flush, retry, status. |
| `syncActivity.ts` | User-visible log of what sync fetched, resolved and sent. Not the Dexie `syncLog` table, which is for Lichess imports. |
| `replay.ts` | `replayEvents()`, `rebuildAllCards()`, `bindOrphanEvents()`. |

**Events are addressed by Lichess identity, never `card_id`** — that's a local
auto-increment which differs per device for the same puzzle. The identity
(`lichess_puzzle_id`, or `lichess_game_id` + `game_move_number`) is denormalised
onto every `reviewLog` row, which is what lets an event arrive *before* its card
exists: such rows are stored with `card_id = ORPHAN_CARD_ID` (`-1`, since
IndexedDB won't index `null`) and are attached by `bindOrphanEvents()` after the
next Lichess sync creates the card.

Dedup is by `event_id` (client-generated UUID, unique index), so merging is
idempotent and order-independent.

**Replay respects `original_failure_at`** as a reset boundary. `syncPuzzles()`
resets a re-failed puzzle to `new`, a state change that leaves no trace in
`reviewLog`; without the boundary, replay would resurrect the discarded
schedule. The value comes from Lichess, so every device derives the same cut.

**Meta reconciliation** is by rule, not overwrite: Lichess cursors take the max
(they're per-account, not per-device), `extra_new_today` takes the later date or
the larger bonus within a date, and `new_cards_per_day` is last-writer-wins via
a `_updated_at` stamp — write it with `setSyncedMeta()`, not `setMeta()`.

**The daily new-card cap counts from `reviewLog`**, not from `cards.reps === 1`:
distinct card identities whose earliest event is today. That makes the cap
inherently shared once events merge, and means two devices that race on the same
new card burn one slot rather than two.

Drive has no conditional write, so `push()` re-checks the file `version` and
merges any peer write before overwriting. Pull skips the download entirely when
`version` is unchanged.

**Batch state is persisted** (`drive_pending_count` / `drive_pending_since` in
`meta`), not held in module scope. The review page calls
`window.location.reload()` after every card, which would otherwise reset the
counter and destroy the debounce timer on each review — making every card its
own full-file upload. `flush(reason, force)` uploads when the batch is ripe (10
reviews or 2 minutes); `force` is used by "Sync now" and by the tab-hidden and
page-close triggers, where the session may be ending.

`syncOnStart()` is throttled (`drive_last_pull_at`) and defers to the batching
policy instead of forcing a push — with reload-per-card, "app start" fires once
per review, and an unconditional pull-and-push there is a Drive round trip per
card.

**Drive's `version` in an upload response is stale.** It bumps again when the
resumable session finalises, so `push()` re-reads the settled version with a
`findSyncFile()` call. Trusting the response value makes every pull re-download
a file we just wrote, and makes the next push mistake our own write for a peer's.

**Only 401 — and 403 with an auth-specific `reason` — means "reconnect".** Other
403s (Drive API not enabled, rate limit, quota) are real failures that
re-authorising cannot fix, and `drive.ts` surfaces Google's own error message
rather than a generic one.

### Durability

Browser storage can be evicted. The app calls `navigator.storage.persist()`
(`requestPersistentStorage()`) on load and after connecting, and surfaces
export/import as the backup path. There is no cross-device sync.

### Lichess API notes

- Auth: OAuth 2.0 PKCE, scope `puzzle:read`, token in Dexie `meta`. Public game endpoints need no scope.
- Calls run directly from the browser; Lichess sets permissive CORS on these read endpoints.
- Puzzle activity endpoint returns ndjson sorted newest-first; `since` param filters by timestamp.
- Game export: `?analyzed=true&evals=true` returns JSON analysis array indexed per half-move. `analysis[i].best` is UCI; moves string is SAN.
- Cloud eval returns 404 when the position isn't in the database — `evaluateMove()` handles this by requiring the exact best move as fallback.
- Storm/Streak: no per-puzzle failure data available via API; excluded from scope.

### Deployment

Static host (eventual target: GitHub Pages / `*.github.io`). No process to run —
serve `build/`. For a subpath deploy, set `kit.paths.base` and the OAuth
redirect/links follow automatically. GH Pages deploy scripting is not set up yet.
