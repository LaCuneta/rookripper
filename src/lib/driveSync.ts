import { getMeta, setMeta, deleteMeta } from './db';
import { db } from './db';
import { GoogleAuthError, isGoogleConnected } from './googleAuth';
import {
  findSyncFile,
  downloadSyncFile,
  uploadSyncFile,
  deleteSyncFile,
  type RemoteFile
} from './drive';
import { buildSyncFile, mergeSyncFile, assertSyncFile, type MergeResult } from './syncFile';
import { logSync } from './syncActivity';
import { bindOrphanEvents } from './replay';
import { ORPHAN_CARD_ID } from './identity';

// Sync orchestration. Reviews always commit to IndexedDB first and never block
// on Drive, so the app stays fully usable offline; Drive is a background flush
// of the review log plus a merge of whatever peers have written.

const FILE_ID_KEY = 'drive_file_id';
const VERSION_KEY = 'drive_last_version';
const SYNCED_AT_KEY = 'drive_last_synced_at';
// Batch state is persisted, not held in memory: the review page reloads the
// document after every card, which would otherwise reset the counter and kill
// the debounce timer on each review — turning every card into its own upload.
const PENDING_COUNT_KEY = 'drive_pending_count';
const PENDING_SINCE_KEY = 'drive_pending_since';
const PULLED_AT_KEY = 'drive_last_pull_at';

/** Flush after this many local reviews, or this long after the first of them. */
const FLUSH_AFTER_REVIEWS = 10;
const FLUSH_DEBOUNCE_MS = 120_000;
/** How stale the last pull must be before an app load checks Drive again. */
const START_PULL_THROTTLE_MS = 120_000;
const RETRY_BACKOFF_MS = [5_000, 20_000, 60_000];

export type SyncPhase = 'idle' | 'pulling' | 'pushing' | 'error';

/** Why a sync ran — surfaced in the activity log. */
export type SyncReason =
  | 'manual'
  | 'app start'
  | 'review batch'
  | 'debounce timer'
  | 'tab hidden'
  | 'page close'
  | 'reconnected'
  | 'retry';

const REASON_LABEL: Record<SyncReason, string> = {
  manual: 'you asked',
  'app start': 'app start',
  'review batch': 'review batch',
  'debounce timer': 'batch timer',
  'tab hidden': 'tab hidden',
  'page close': 'page closing',
  reconnected: 'back online',
  retry: 'retry after failure'
};

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncedAt: number | null;
  pending: boolean;
  error: string | null;
  /** The user must re-authorize before sync can work again. */
  needsReconnect: boolean;
}

let status: SyncStatus = {
  phase: 'idle',
  lastSyncedAt: null,
  pending: false,
  error: null,
  needsReconnect: false
};

const listeners = new Set<(s: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function update(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
}

// ── Pull ───────────────────────────────────────────────────────────────────
export interface PullResult extends MergeResult {
  /** True when the remote file was unchanged since the last pull. */
  unchanged: boolean;
}

const EMPTY_MERGE: MergeResult = {
  eventsAdded: 0,
  eventsSkipped: 0,
  orphanEvents: 0,
  cardsUpdated: 0,
  metaChanged: []
};

export async function pull(): Promise<PullResult> {
  update({ phase: 'pulling', error: null });
  logSync('info', 'Checking Drive for changes…');
  // Stamped up front: a failed pull should still hold off the throttled
  // app-start check, otherwise every reload retries a broken Drive.
  await setMeta(PULLED_AT_KEY, String(Date.now()));
  try {
    const remote = await findSyncFile();
    if (!remote) {
      // First run on this account: nothing to merge, our push creates the file.
      await deleteMeta(FILE_ID_KEY);
      logSync('info', 'No sync file in Drive yet — this device will create it.');
      return { ...EMPTY_MERGE, unchanged: true };
    }

    await setMeta(FILE_ID_KEY, remote.id);

    // `version` bumps on every Drive-side change, so an unchanged version means
    // the download would return exactly what we already merged.
    const seen = await getMeta(VERSION_KEY);
    if (seen && seen === remote.version) {
      await setMeta(SYNCED_AT_KEY, String(Date.now()));
      update({ lastSyncedAt: Date.now() });
      logSync('info', 'Remote unchanged — skipped download.', `version ${remote.version}`);
      return { ...EMPTY_MERGE, unchanged: true };
    }

    const content = await downloadSyncFile(remote.id);
    assertSyncFile(content);
    logSync(
      'info',
      `Downloaded sync file — ${content.events.length} event${content.events.length === 1 ? '' : 's'}.`,
      `version ${remote.version}, last written ${new Date(content.exportedAt).toLocaleString()}` +
        (content.device_id ? ` by device ${content.device_id.slice(0, 8)}` : '')
    );

    const merged = await mergeSyncFile(content);
    logMergeResult(merged);

    // Events may name cards this device has synced since the last rebuild.
    if (merged.orphanEvents > 0) {
      const bound = await bindOrphanEvents();
      if (bound > 0) {
        logSync('success', `Attached ${bound} waiting event${bound === 1 ? '' : 's'} to cards.`);
      }
    }

    await setMeta(VERSION_KEY, remote.version);
    await setMeta(SYNCED_AT_KEY, String(Date.now()));
    update({ lastSyncedAt: Date.now() });
    return { ...merged, unchanged: false };
  } finally {
    if (status.phase === 'pulling') update({ phase: 'idle' });
  }
}

/** Report what the merge actually resolved, not just that it ran. */
function logMergeResult(merged: MergeResult): void {
  if (merged.eventsAdded === 0) {
    logSync(
      'info',
      merged.eventsSkipped > 0
        ? `Nothing new — all ${merged.eventsSkipped} remote events were already known.`
        : 'Nothing new to merge.'
    );
  } else {
    logSync(
      'success',
      `Merged ${merged.eventsAdded} new review${merged.eventsAdded === 1 ? '' : 's'} from other devices.`,
      [
        `${merged.eventsSkipped} already known`,
        `${merged.cardsUpdated} card${merged.cardsUpdated === 1 ? '' : 's'} rescheduled`,
        merged.orphanEvents > 0
          ? `${merged.orphanEvents} waiting on cards not yet pulled from Lichess`
          : null
      ]
        .filter(Boolean)
        .join(' · ')
    );
  }

  if (merged.metaChanged.length > 0) {
    logSync('info', `Settings reconciled: ${merged.metaChanged.join(', ')}.`);
  }
}

// ── Push ───────────────────────────────────────────────────────────────────
export async function push(reason: SyncReason = 'manual'): Promise<RemoteFile | null> {
  update({ phase: 'pushing', error: null });
  try {
    let remote = await findSyncFile();
    const seen = await getMeta(VERSION_KEY);

    // Optimistic concurrency: Drive has no conditional write, so if the file
    // changed since our last pull, merge that change in before overwriting —
    // otherwise a peer's reviews would be silently dropped.
    if (remote && seen && remote.version !== seen) {
      logSync(
        'warn',
        'Another device wrote to Drive since the last check — merging before upload.',
        `theirs ${remote.version}, ours ${seen}`
      );
      const content = await downloadSyncFile(remote.id);
      assertSyncFile(content);
      const merged = await mergeSyncFile(content);
      logMergeResult(merged);
      if (merged.orphanEvents > 0) await bindOrphanEvents();
      await setMeta(VERSION_KEY, remote.version);
      remote = await findSyncFile();
    }

    const file = await buildSyncFile();
    logSync(
      'info',
      `Uploading ${file.events.length} event${file.events.length === 1 ? '' : 's'} (${REASON_LABEL[reason]})…`
    );
    const written = await uploadSyncFile(file, remote?.id);
    await setMeta(FILE_ID_KEY, written.id);

    // Drive bumps `version` again when the resumable session finalises, so the
    // value in the upload response is already one behind. Trusting it makes the
    // next pull re-download a file we just wrote, and makes a later push mistake
    // our own write for a peer's. Re-read the settled version instead.
    const settled = await findSyncFile();
    const version = settled?.version ?? written.version;
    if (version) await setMeta(VERSION_KEY, version);
    await setMeta(SYNCED_AT_KEY, String(Date.now()));
    await clearPending();
    clearFlushTimer();
    update({ lastSyncedAt: Date.now(), pending: false });
    logSync('success', 'Upload complete — Drive is up to date.', `version ${version}`);
    return { ...written, version };
  } finally {
    if (status.phase === 'pushing') update({ phase: 'idle' });
  }
}

/** Pull then push — the full round trip behind "Sync now". */
export async function syncNow(reason: SyncReason = 'manual'): Promise<void> {
  if (!(await isGoogleConnected())) return;
  await runGuarded(async () => {
    await pull();
    await push(reason);
  });
}

/**
 * Sync when the app loads. Throttled, and it defers to the batching policy
 * rather than forcing an upload, because "app start" is not a rare event here:
 * the review page reloads the document after every card, so a naive
 * pull-and-push on load would mean a full Drive round trip per review.
 */
export async function syncOnStart(): Promise<void> {
  if (!(await isGoogleConnected())) return;

  const last = parseInt((await getMeta(PULLED_AT_KEY)) ?? '0') || 0;
  const dueForPull = Date.now() - last >= START_PULL_THROTTLE_MS;

  if (dueForPull) {
    await runGuarded(async () => {
      await pull();
    });
  }
  // Uploads only when the batch is ripe; a single unsent review waits for the
  // count, the timer, or the tab closing.
  await flush('app start');

  const batch = await readPending();
  if (batch.count > 0) armFlushTimer(batch);
}

// ── Failure handling ───────────────────────────────────────────────────────
let retryIndex = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

/** Serialise sync work and turn failures into status rather than exceptions. */
async function runGuarded(work: () => Promise<void>): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await work();
      retryIndex = 0;
      update({ error: null, needsReconnect: false });
    } catch (err) {
      const authError = err instanceof GoogleAuthError && err.needsReconnect;
      const message = err instanceof Error ? err.message : String(err);
      update({ phase: 'error', error: message, needsReconnect: authError });
      logSync(
        'error',
        authError ? 'Sync stopped — Google access needs renewing.' : 'Sync failed.',
        message
      );
      // Re-auth needs the user; retrying on a timer would only spam popups.
      if (!authError) scheduleRetry();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = RETRY_BACKOFF_MS[Math.min(retryIndex, RETRY_BACKOFF_MS.length - 1)];
  retryIndex++;
  logSync('info', `Retrying in ${Math.round(delay / 1000)}s.`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush('retry');
  }, delay);
}

// ── Flush scheduling ───────────────────────────────────────────────────────
let flushTimer: ReturnType<typeof setTimeout> | null = null;

interface PendingBatch {
  count: number;
  since: number;
}

async function readPending(): Promise<PendingBatch> {
  const [count, since] = await Promise.all([
    getMeta(PENDING_COUNT_KEY),
    getMeta(PENDING_SINCE_KEY)
  ]);
  return { count: parseInt(count ?? '0') || 0, since: parseInt(since ?? '0') || 0 };
}

async function clearPending(): Promise<void> {
  await deleteMeta(PENDING_COUNT_KEY);
  await deleteMeta(PENDING_SINCE_KEY);
}

/** Batch is full, or the oldest unsent review has waited long enough. */
function batchIsRipe(batch: PendingBatch): boolean {
  return (
    batch.count >= FLUSH_AFTER_REVIEWS ||
    (batch.since > 0 && Date.now() - batch.since >= FLUSH_DEBOUNCE_MS)
  );
}

function clearFlushTimer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/**
 * Push local events. `force` skips the batching policy — used by "Sync now" and
 * by the app-start sync, where the user is plainly waiting for it.
 */
export async function flush(reason: SyncReason = 'review batch', force = false): Promise<void> {
  if (!(await isGoogleConnected())) return;

  const batch = await readPending();
  if (batch.count === 0) return;
  if (!force && !batchIsRipe(batch)) return;

  await runGuarded(async () => {
    await push(reason);
  });
}

/**
 * Called after each review. Uploads on a review count or a debounce window,
 * never once per review — the whole file is rewritten on each push, so a push
 * per card would waste bandwidth that grows with the history.
 */
export async function markReviewed(): Promise<void> {
  if (!(await isGoogleConnected())) return;

  const batch = await readPending();
  const next: PendingBatch = {
    count: batch.count + 1,
    since: batch.since || Date.now()
  };
  await setMeta(PENDING_COUNT_KEY, String(next.count));
  await setMeta(PENDING_SINCE_KEY, String(next.since));
  update({ pending: true });

  if (batchIsRipe(next)) {
    clearFlushTimer();
    // Awaited so the batch state is settled when this resolves; callers invoke
    // markReviewed() as fire-and-forget, so the UI still never waits on Drive.
    await flush('review batch');
    return;
  }
  armFlushTimer(next);
}

/**
 * Backstop for a session that goes idle mid-batch. The timer dies with the
 * document, which is why `since` is persisted and re-checked on every trigger —
 * and why a page load with unsent reviews has to re-arm it, or a batch left by
 * a closed tab would wait for the next review that may never come.
 */
function armFlushTimer(batch: PendingBatch): void {
  if (flushTimer) return;
  const waited = batch.since > 0 ? Date.now() - batch.since : 0;
  const delay = Math.max(1_000, FLUSH_DEBOUNCE_MS - waited);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush('debounce timer');
  }, delay);
}

async function hasPending(): Promise<boolean> {
  return (await readPending()).count > 0;
}

/**
 * Wire the background triggers. Returns a teardown function.
 *
 * `pagehide` is best-effort only: Drive has no sendBeacon-compatible endpoint,
 * so a flush started there may be killed mid-request. The visibility flush is
 * the one that reliably lands, which is why it comes first.
 */
export function installSyncTriggers(): () => void {
  // Both hide events force the batch out: the user may not come back, and the
  // batching policy exists to avoid uploading mid-session, not to withhold work
  // when the session is ending.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void flush('tab hidden', true);
  };
  const onOnline = () => void syncNow('reconnected');
  const onPageHide = () => void flush('page close', true);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pagehide', onPageHide);
    clearFlushTimer();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}

/** Restore the status a page load should start from. */
export async function initSyncStatus(): Promise<SyncStatus> {
  const [syncedAt, pending, connected] = await Promise.all([
    getMeta(SYNCED_AT_KEY),
    hasPending(),
    isGoogleConnected()
  ]);
  update({
    lastSyncedAt: syncedAt ? parseInt(syncedAt) : null,
    pending: pending && connected
  });
  return status;
}

/** Remove the sync file from Drive. The local history is untouched. */
export async function deleteRemoteFile(): Promise<void> {
  const remote = await findSyncFile();
  if (remote) await deleteSyncFile(remote.id);
  logSync('warn', 'Deleted the sync file from Google Drive.');
  await deleteMeta(FILE_ID_KEY);
  await deleteMeta(VERSION_KEY);
  await deleteMeta(SYNCED_AT_KEY);
  update({ lastSyncedAt: null });
}

/**
 * Local counts for the settings UI: how much history exists and how much of it
 * is waiting on a card this device hasn't synced from Lichess yet.
 */
export async function syncCounts(): Promise<{ events: number; orphans: number }> {
  const [events, orphans] = await Promise.all([
    db.reviewLog.count(),
    db.reviewLog.where('card_id').equals(ORPHAN_CARD_ID).count()
  ]);
  return { events, orphans };
}
