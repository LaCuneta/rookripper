export type CardSource = 'puzzle' | 'game';
export type Judgment = 'Blunder' | 'Mistake' | 'Inaccuracy';
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface Card {
  id?: number; // assigned by Dexie on insert; always present once persisted
  source: CardSource;

  lichess_puzzle_id: string | null;
  puzzle_rating: number | null;
  puzzle_themes: string | null;
  solution_moves: string | null; // JSON-encoded string[]

  lichess_game_id: string | null;
  game_move_number: number | null;
  played_move: string | null; // UCI — original blunder
  best_move: string | null;   // UCI — engine's top choice
  eval_before: number | null; // centipawns, white's perspective
  eval_after: number | null;
  judgment: Judgment | null;

  fen: string;
  last_move: string | null; // UCI — the move that set up the position

  due: number;           // unix ms
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: CardState;
  last_reviewed_at: number | null;

  original_failure_at: number | null;
  added_at: number;
}

// A review event. `event_id` is the cross-device merge key: `id` is a local
// auto-increment that two devices would collide on, and `card_id` is likewise
// device-local, so the Lichess identity (puzzle id, or game id + move number) is
// denormalised onto every row. That lets an event pulled from another device be
// stored before the card it refers to exists locally — an orphan carries
// `card_id: null` until the next Lichess sync creates its card.
export interface ReviewLog {
  id?: number;
  event_id: string; // UUID, client-generated at insert
  device_id: string; // UUID of the device that recorded the review
  card_id: number; // ORPHAN_CARD_ID while the local card doesn't exist yet
  source: CardSource;
  lichess_puzzle_id: string | null; // set iff source === 'puzzle'
  lichess_game_id: string | null; // set iff source === 'game'
  game_move_number: number | null; // set iff source === 'game'
  reviewed_at: number;
  rating: number;
  user_move: string | null;
  move_accepted: number; // 0 | 1
  centipawn_loss: number | null;
  duration_ms: number | null;
}

/** The SRS fields of a card — everything replay reproduces from its events. */
export type CardProjection = Pick<
  Card,
  | 'due'
  | 'stability'
  | 'difficulty'
  | 'elapsed_days'
  | 'scheduled_days'
  | 'reps'
  | 'lapses'
  | 'state'
  | 'last_reviewed_at'
>;

export interface MetaRow {
  key: string;
  value: string;
}

export interface SyncLogRow {
  id?: number;
  sync_type: 'puzzles' | 'games';
  started_at: number;
  completed_at: number | null;
  items_fetched: number | null;
  items_added: number | null;
  error: string | null;
}

export interface DueStats {
  due: number;
  new: number;
  learning: number;
}

// JSON backup / export format. Emitted by scripts/dump-sql-to-json.mjs and by
// src/lib/export.ts; consumed by importData(). `meta` carries only sync cursors
// and limits — never the access token.
export interface Backup {
  version: 1;
  app: 'rookripper';
  exportedAt: number;
  cards: Card[];
  reviewLog: BackupReviewLog[];
  meta: Record<string, string>;
}

/** A reviewLog row as found in a backup: pre-v2 dumps have no sync fields. */
export type BackupReviewLog = Partial<ReviewLog> & Pick<ReviewLog, 'reviewed_at' | 'rating'>;
