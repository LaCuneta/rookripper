import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { LayoutLoad } from './$types';
import { isConnected } from '$lib/oauth';

// Fully client-rendered SPA — all data lives in the browser (Dexie), so there
// is no server to render on. ssr=false makes every route CSR-only.
export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ url, route }) => {
  const configured = await isConnected();

  // /setup handles connecting (and the OAuth callback), so it stays reachable
  // while disconnected.
  if (!configured && route.id !== '/setup') {
    throw redirect(302, `${base}/setup`);
  }

  return { configured };
};
