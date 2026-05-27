import { json } from '@sveltejs/kit';
import db from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const row = db.prepare("SELECT value FROM config WHERE key = 'new_cards_per_day'").get() as { value: string } | undefined;
  return json({ newCardsPerDay: row ? parseInt(row.value) : 20 });
};

export const PATCH: RequestHandler = async ({ request }) => {
  const body = await request.json();
  if (typeof body.newCardsPerDay === 'number') {
    const val = Math.max(0, Math.floor(body.newCardsPerDay));
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('new_cards_per_day', ?)").run(String(val));
  }
  return json({ ok: true });
};
