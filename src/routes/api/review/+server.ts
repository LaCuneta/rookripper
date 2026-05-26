import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { applyReview } from '$lib/server/srs';
import type { Grade } from 'ts-fsrs';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { cardId, rating, userMove, moveAccepted, centipawnLoss, durationMs } = body;

  if (!cardId || !rating) throw error(400, 'cardId and rating required');

  const fsrsRating = Number(rating) as Grade;
  if (![1, 2, 3, 4].includes(fsrsRating)) throw error(400, 'rating must be 1-4');

  applyReview(
    cardId,
    fsrsRating,
    userMove ?? null,
    moveAccepted ?? true,
    centipawnLoss ?? null,
    durationMs ?? null
  );

  return json({ ok: true });
};
