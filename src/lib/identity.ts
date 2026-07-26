import type { Card, CardSource, ReviewLog } from './types';

// Cards are correlated across devices by their Lichess identity, never by
// `card_id` (a device-local auto-increment that differs per device for the same
// puzzle). `identityKey()` renders one as a string for Map/Set dedup; the raw
// fields are what get indexed and written to the sync file.

// Events pulled from another device can name a card this one hasn't synced from
// Lichess yet. They are stored immediately with this sentinel rather than a real
// card_id: IndexedDB drops records with a null indexed key, so null would make
// the orphans unqueryable on the `card_id` index.
export const ORPHAN_CARD_ID = -1;

export interface CardIdentity {
  source: CardSource;
  lichess_puzzle_id: string | null;
  lichess_game_id: string | null;
  game_move_number: number | null;
}

export function cardIdentity(card: Card): CardIdentity {
  return {
    source: card.source,
    lichess_puzzle_id: card.lichess_puzzle_id,
    lichess_game_id: card.lichess_game_id,
    game_move_number: card.game_move_number
  };
}

/** Stable string key, or null when the row carries no usable identity. */
export function identityKey(id: CardIdentity | ReviewLog): string | null {
  if (id.source === 'puzzle') {
    return id.lichess_puzzle_id ? `p:${id.lichess_puzzle_id}` : null;
  }
  return id.lichess_game_id && id.game_move_number != null
    ? `g:${id.lichess_game_id}:${id.game_move_number}`
    : null;
}

export function hasIdentity(id: CardIdentity | ReviewLog): boolean {
  return identityKey(id) !== null;
}
