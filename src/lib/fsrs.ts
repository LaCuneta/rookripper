import { fsrs, State, createEmptyCard, type Card as FSRSCard } from 'ts-fsrs';
import type { Card, CardProjection, CardState } from './types';

// One shared scheduler instance. Live scheduling (srs.ts) and history replay
// (replay.ts) must use identical parameters or replay would drift from the
// state it is supposed to reproduce, so neither module constructs its own.
export const scheduler = fsrs();

const STATE_TO_LABEL: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning'
};

const LABEL_TO_STATE: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning
};

export function stateLabel(s: State): CardState {
  return STATE_TO_LABEL[s] ?? 'new';
}

export function toFSRS(card: Card): FSRSCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: LABEL_TO_STATE[card.state] ?? State.New,
    last_review: card.last_reviewed_at ? new Date(card.last_reviewed_at) : undefined
  };
}

/** The persisted shape of a scheduled FSRS card. `reviewedAt` is its last review. */
export function toProjection(next: FSRSCard, reviewedAt: number): CardProjection {
  return {
    due: next.due.getTime(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsed_days: next.elapsed_days,
    scheduled_days: next.scheduled_days,
    reps: next.reps,
    lapses: next.lapses,
    state: stateLabel(next.state),
    last_reviewed_at: reviewedAt
  };
}

export { createEmptyCard, State };
