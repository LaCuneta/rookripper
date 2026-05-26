export type CardSource = 'puzzle' | 'game';
export type Judgment = 'Blunder' | 'Mistake' | 'Inaccuracy';
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface Card {
  id: number;
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

export interface DueStats {
  due: number;
  new: number;
  learning: number;
}

export interface SyncStatus {
  last_puzzle_sync: number | null;
  last_game_sync: number | null;
  recent_errors: string[];
}
