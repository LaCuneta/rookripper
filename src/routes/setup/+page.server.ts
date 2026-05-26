import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import db from '$lib/server/db';
import { getUsername } from '$lib/server/lichess';

export const load: PageServerLoad = async () => {
  const tokenRow = db.prepare("SELECT value FROM config WHERE key = 'access_token'").get() as
    | { value: string }
    | undefined;
  const usernameRow = db.prepare("SELECT value FROM config WHERE key = 'lichess_username'").get() as
    | { value: string }
    | undefined;

  return {
    hasToken: !!tokenRow,
    username: usernameRow?.value ?? null
  };
};

export const actions: Actions = {
  save: async ({ request }) => {
    const data = await request.formData();
    const token = (data.get('token') as string | null)?.trim();

    if (!token) return fail(400, { error: 'Token is required.' });

    // Verify token works and fetch username
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
      'access_token',
      token
    );

    try {
      const username = await getUsername();
      db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
        'lichess_username',
        username
      );
    } catch {
      db.prepare("DELETE FROM config WHERE key = 'access_token'").run();
      return fail(400, { error: 'Token invalid or Lichess unreachable. Please check and retry.' });
    }

    throw redirect(302, '/');
  }
};
