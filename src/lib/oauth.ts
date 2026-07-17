import { base } from '$app/paths';
import { getMeta, setMeta, deleteMeta } from './db';
import { getUsername, revokeToken } from './lichess';

// Lichess OAuth 2.0 with PKCE — the public-client flow, no secret, no backend.
// See https://lichess.org/api#tag/OAuth.
const AUTHORIZE_URL = 'https://lichess.org/oauth';
const SCOPES = 'puzzle:read';

const VERIFIER_KEY = 'rookripper_oauth_verifier';
const STATE_KEY = 'rookripper_oauth_state';

// client_id and redirect_uri derive from the live origin + SvelteKit base path,
// so the same code works on localhost and on a github.io subpath without edits.
function appOrigin(): string {
  return `${window.location.origin}${base}`;
}
function redirectUri(): string {
  return `${appOrigin()}/setup`;
}
function clientId(): string {
  // Lichess accepts any URL as a public-client id; convention is the app home.
  return `${appOrigin()}/`;
}

// ── PKCE primitives ─────────────────────────────────────────────────────────
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(byteLen: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLen)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// ── Flow ────────────────────────────────────────────────────────────────────
/** Redirect the browser to Lichess to authorize. Does not return. */
export async function beginLogin(): Promise<void> {
  const verifier = randomString(48);
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await pkceChallenge(verifier),
    state
  });

  window.location.href = `${AUTHORIZE_URL}?${params}`;
}

/** True if the current URL is an OAuth redirect carrying a code or error. */
export function isCallback(url: URL): boolean {
  return url.searchParams.has('code') || url.searchParams.has('error');
}

/**
 * Complete the redirect: verify state, exchange the code for a token, persist
 * the token + username. Returns the Lichess username. Throws on any failure.
 */
export async function completeLogin(url: URL): Promise<string> {
  const error = url.searchParams.get('error');
  if (error) throw new Error(`Lichess authorization was denied (${error}).`);

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code) throw new Error('Missing authorization code.');

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const savedState = sessionStorage.getItem(STATE_KEY);
  if (!verifier || !savedState || returnedState !== savedState) {
    throw new Error('OAuth state mismatch — please try connecting again.');
  }

  const res = await fetch('https://lichess.org/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri(),
      client_id: clientId()
    })
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}).`);

  const data = await res.json();
  if (!data.access_token) throw new Error('No access token returned.');

  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  await setMeta('access_token', data.access_token);
  const username = await getUsername();
  await setMeta('lichess_username', username);
  return username;
}

export async function isConnected(): Promise<boolean> {
  return !!(await getMeta('access_token'));
}

/** Revoke the token on Lichess (best-effort) and clear local credentials. */
export async function logout(): Promise<void> {
  try {
    await revokeToken();
  } catch {
    // Network/token already-invalid — clear locally regardless.
  }
  await deleteMeta('access_token');
  await deleteMeta('lichess_username');
}
