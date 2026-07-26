import { getMeta, setMeta, deleteMeta } from './db';

// Google Identity Services token flow. Like the Lichess side this is a public
// client with no secret and no backend, but it is *not* PKCE: GIS hands back a
// short-lived access token directly and re-issues it silently while the user's
// grant stands, so there is no refresh-token dance to implement.
//
// Scope is `drive.appdata` only — a hidden per-app folder. It cannot read or
// write anything else in the user's Drive, and the Cloud Console classifies it
// as non-sensitive, so publishing the app needs no verification review.
const CLIENT_ID = '963552079925-u6u431c79f0nv9asomd57hq8u1u8okhv.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

const TOKEN_KEY = 'google_access_token';
const EXPIRY_KEY = 'google_token_expires_at';
const CONNECTED_KEY = 'google_connected';

// Refresh a little early so a request can't start with a token that expires
// mid-flight.
const EXPIRY_MARGIN_MS = 60_000;

// Minimal shape of the GIS token client — @types/google.accounts would be a
// dependency for three call signatures.
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

export class GoogleAuthError extends Error {
  /** True when the user must interact again (popup blocked, grant withdrawn). */
  readonly needsReconnect: boolean;
  constructor(message: string, needsReconnect = false) {
    super(message);
    this.name = 'GoogleAuthError';
    this.needsReconnect = needsReconnect;
  }
}

let scriptPromise: Promise<GoogleOAuth2> | null = null;

function loadGis(): Promise<GoogleOAuth2> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<GoogleOAuth2>((resolve, reject) => {
    const existing = window.google?.accounts?.oauth2;
    if (existing) return resolve(existing);

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new GoogleAuthError('Google sign-in script loaded but exposed no API.'));
    };
    script.onerror = () =>
      reject(new GoogleAuthError('Could not load Google sign-in (offline or blocked).'));
    document.head.appendChild(script);
  }).catch((err) => {
    scriptPromise = null; // let a later attempt retry the load
    throw err;
  });
  return scriptPromise;
}

/**
 * Ask GIS for a token. `prompt: ''` is the silent path — it succeeds without UI
 * once the user has granted the scope, and fails if the grant is gone.
 */
async function requestToken(prompt: '' | 'consent'): Promise<string> {
  const oauth2 = await loadGis();

  const response = await new Promise<TokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: resolve,
      error_callback: (e) =>
        reject(
          new GoogleAuthError(
            e.type === 'popup_closed'
              ? 'Google sign-in was cancelled.'
              : (e.message ?? 'Google sign-in failed.'),
            true
          )
        )
    });
    client.requestAccessToken({ prompt });
  });

  if (response.error || !response.access_token) {
    throw new GoogleAuthError(
      response.error_description ?? response.error ?? 'Google did not return a token.',
      true
    );
  }

  const expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
  await setMeta(TOKEN_KEY, response.access_token);
  await setMeta(EXPIRY_KEY, String(expiresAt));
  await setMeta(CONNECTED_KEY, '1');
  return response.access_token;
}

/** Interactive connect. Shows the Google consent popup. */
export async function connectGoogle(): Promise<void> {
  await requestToken('consent');
}

export async function isGoogleConnected(): Promise<boolean> {
  return (await getMeta(CONNECTED_KEY)) === '1';
}

/**
 * A usable access token, refreshed silently when the cached one has expired.
 * Throws `GoogleAuthError` with `needsReconnect` when the user must act.
 */
export async function getGoogleToken(): Promise<string> {
  if (!(await isGoogleConnected())) {
    throw new GoogleAuthError('Google Drive is not connected.', true);
  }

  const token = await getMeta(TOKEN_KEY);
  const expiresAt = parseInt((await getMeta(EXPIRY_KEY)) ?? '0');
  if (token && expiresAt - EXPIRY_MARGIN_MS > Date.now()) return token;

  return requestToken('');
}

/** Force the next call to fetch a fresh token (used after a 401). */
export async function invalidateGoogleToken(): Promise<void> {
  await deleteMeta(TOKEN_KEY);
  await deleteMeta(EXPIRY_KEY);
}

/**
 * Revoke the grant with Google (best-effort) and clear local credentials. The
 * Drive file is deliberately left in place — reconnecting picks it back up. Use
 * `deleteRemoteFile()` to remove it explicitly.
 */
export async function disconnectGoogle(): Promise<void> {
  const token = await getMeta(TOKEN_KEY);
  if (token) {
    try {
      const oauth2 = await loadGis();
      await new Promise<void>((resolve) => oauth2.revoke(token, resolve));
    } catch {
      // Offline or script blocked — clearing locally is still correct.
    }
  }
  await invalidateGoogleToken();
  await deleteMeta(CONNECTED_KEY);
}
