import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import { mkdirSync } from 'fs';

const DATA_DIR = env.DATA_DIR ?? './data';
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(`${DATA_DIR}/rookripper.db`);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    source              TEXT    NOT NULL CHECK(source IN ('puzzle','game')),

    lichess_puzzle_id   TEXT    UNIQUE,
    puzzle_rating       INTEGER,
    puzzle_themes       TEXT,
    solution_moves      TEXT,

    lichess_game_id     TEXT,
    game_move_number    INTEGER,
    played_move         TEXT,
    best_move           TEXT,
    eval_before         INTEGER,
    eval_after          INTEGER,
    judgment            TEXT    CHECK(judgment IN ('Blunder','Mistake','Inaccuracy')),

    fen                 TEXT    NOT NULL,
    last_move           TEXT,

    due                 INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    stability           REAL    NOT NULL DEFAULT 0,
    difficulty          REAL    NOT NULL DEFAULT 0,
    elapsed_days        INTEGER NOT NULL DEFAULT 0,
    scheduled_days      INTEGER NOT NULL DEFAULT 0,
    reps                INTEGER NOT NULL DEFAULT 0,
    lapses              INTEGER NOT NULL DEFAULT 0,
    state               TEXT    NOT NULL DEFAULT 'new'
                          CHECK(state IN ('new','learning','review','relearning')),
    last_reviewed_at    INTEGER,

    original_failure_at INTEGER,
    added_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

    UNIQUE(lichess_game_id, game_move_number)
  );

  CREATE TABLE IF NOT EXISTS review_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id         INTEGER NOT NULL REFERENCES cards(id),
    reviewed_at     INTEGER NOT NULL,
    rating          INTEGER NOT NULL,
    user_move       TEXT,
    move_accepted   INTEGER NOT NULL DEFAULT 0,
    centipawn_loss  INTEGER,
    duration_ms     INTEGER
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type      TEXT    NOT NULL,
    started_at     INTEGER NOT NULL,
    completed_at   INTEGER,
    items_fetched  INTEGER,
    items_added    INTEGER,
    error          TEXT
  );
`);

export default db;
