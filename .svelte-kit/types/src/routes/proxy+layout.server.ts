// @ts-nocheck
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import db from '$lib/server/db';

export const load = async ({ url }: Parameters<LayoutServerLoad>[0]) => {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('access_token') as
    | { value: string }
    | undefined;
  const configured = !!row;

  const isSetup = url.pathname.startsWith('/setup');
  const isApi = url.pathname.startsWith('/api');

  if (!configured && !isSetup && !isApi) {
    throw redirect(302, '/setup');
  }

  return { configured };
};
