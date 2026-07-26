import { getGoogleToken, invalidateGoogleToken, GoogleAuthError } from './googleAuth';

// Google Drive appData REST wrappers. `appDataFolder` is a hidden per-app space:
// the file is invisible in the user's Drive UI and unreachable by other apps,
// and it is not counted against a normal folder listing.
const FILE_NAME = 'rookripper-sync.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

export interface RemoteFile {
  id: string;
  /** Monotonic per-file counter. Used to skip redundant downloads and to detect
   *  a peer that wrote while we were editing. */
  version: string;
  modifiedTime: string;
  size?: string;
}

/**
 * Fetch with a bearer token, retrying once through a fresh token on 401 — an
 * access token can expire between the expiry check and the request landing.
 */
async function authedFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getGoogleToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` }
  });

  if (res.status === 401 && retry) {
    await invalidateGoogleToken();
    return authedFetch(url, init, false);
  }
  return res;
}

/** Google's error envelope: `{ error: { message, errors: [{ reason }] } }`. */
function describeError(body: string): { message: string; reason: string } {
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error;
    const reason = err?.errors?.[0]?.reason ?? err?.status ?? '';
    return { message: err?.message ?? body.slice(0, 300), reason: String(reason) };
  } catch {
    return { message: body.slice(0, 300), reason: '' };
  }
}

// A 403 is only an auth problem for these reasons. Everything else that returns
// 403 — the Drive API not enabled on the project, rate limits, storage quota —
// is a real failure that reconnecting would not fix, and saying "reconnect"
// would send the user round a loop that cannot help.
const REAUTH_REASONS = new Set([
  'authError',
  'insufficientPermissions',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'ACCESS_TOKEN_EXPIRED',
  'UNAUTHENTICATED'
]);

async function ensureOk(res: Response, action: string): Promise<Response> {
  if (res.ok) return res;

  const body = await res.text().catch(() => '');
  const { message, reason } = describeError(body);
  const suffix = message ? ` — ${message}` : '';

  if (res.status === 401 || (res.status === 403 && REAUTH_REASONS.has(reason))) {
    throw new GoogleAuthError(`Google denied ${action} (${res.status})${suffix}`, true);
  }
  if (res.status === 403 && reason === 'accessNotConfigured') {
    throw new DriveError(
      `The Drive API is not enabled for this Google Cloud project${suffix}`,
      res.status
    );
  }
  throw new DriveError(
    `${action} failed (${res.status}${reason ? ` ${reason}` : ''})${suffix}`,
    res.status
  );
}

/** Locate the sync file, or null on a first run. */
export async function findSyncFile(): Promise<RemoteFile | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${FILE_NAME}' and trashed = false`,
    fields: 'files(id,version,modifiedTime,size)',
    pageSize: '10'
  });
  const res = await ensureOk(await authedFetch(`${API}/files?${params}`), 'listing Drive files');
  const data: { files?: RemoteFile[] } = await res.json();
  const files = data.files ?? [];
  if (files.length === 0) return null;

  // Defensive: a duplicate can only arise from two devices creating the file at
  // the same instant. Newest wins; the loser is cleaned up on the next push.
  return files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0];
}

export async function downloadSyncFile(fileId: string): Promise<unknown> {
  const res = await ensureOk(
    await authedFetch(`${API}/files/${fileId}?alt=media`),
    'downloading the sync file'
  );
  return res.json();
}

/**
 * Replace (or create) the sync file via a resumable upload. Resumable from the
 * start because the file passes Drive's 5 MB simple-upload ceiling once the
 * review history is a few years deep, and switching later would be a migration.
 */
export async function uploadSyncFile(content: unknown, fileId?: string): Promise<RemoteFile> {
  const body = new TextEncoder().encode(JSON.stringify(content));

  // Step 1 — initiate. Metadata only on create: `parents` is immutable and
  // Drive rejects it on update.
  const metadata = fileId ? {} : { name: FILE_NAME, parents: ['appDataFolder'] };
  const initUrl = fileId
    ? `${UPLOAD_API}/files/${fileId}?uploadType=resumable&fields=id,version,modifiedTime,size`
    : `${UPLOAD_API}/files?uploadType=resumable&fields=id,version,modifiedTime,size`;

  const init = await ensureOk(
    await authedFetch(initUrl, {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/json',
        'X-Upload-Content-Length': String(body.byteLength)
      },
      body: JSON.stringify(metadata)
    }),
    'starting the Drive upload'
  );

  const location = init.headers.get('Location') ?? init.headers.get('location');
  if (!location) throw new DriveError('Drive did not return an upload URL.', init.status);

  // Step 2 — send the content. Single PUT: the payload is small enough that
  // chunked resumption would cost more round-trips than a retry from scratch.
  const upload = await ensureOk(
    await fetch(location, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.byteLength) },
      body
    }),
    'uploading the sync file'
  );

  return upload.json();
}

export async function deleteSyncFile(fileId: string): Promise<void> {
  const res = await authedFetch(`${API}/files/${fileId}`, { method: 'DELETE' });
  // 404 means it is already gone, which is the state we wanted.
  if (res.status === 404) return;
  await ensureOk(res, 'deleting the sync file');
}
