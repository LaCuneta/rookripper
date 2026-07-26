import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RemoteFile } from '$lib/drive';
import type { SyncFile } from '$lib/syncFile';

// A stand-in for the Drive appData folder: one file, a version that bumps on
// every write, and a record of what was requested.
const drive = {
  file: null as { id: string; version: number; content: SyncFile } | null,
  downloads: 0,
  uploads: 0,
  failNextUpload: null as string | null,
  reset() {
    this.file = null;
    this.downloads = 0;
    this.uploads = 0;
    this.failNextUpload = null;
  }
};

vi.mock('$lib/googleAuth', () => ({
  isGoogleConnected: async () => true,
  getGoogleToken: async () => 'test-token',
  invalidateGoogleToken: async () => {},
  GoogleAuthError: class GoogleAuthError extends Error {
    needsReconnect = true;
  }
}));

vi.mock('$lib/drive', () => ({
  DriveError: class DriveError extends Error {},
  findSyncFile: async (): Promise<RemoteFile | null> =>
    drive.file
      ? { id: drive.file.id, version: String(drive.file.version), modifiedTime: '2026-07-26T00:00:00Z' }
      : null,
  downloadSyncFile: async () => {
    drive.downloads++;
    return structuredClone(drive.file!.content);
  },
  uploadSyncFile: async (content: SyncFile, fileId?: string): Promise<RemoteFile> => {
    if (drive.failNextUpload) {
      const message = drive.failNextUpload;
      drive.failNextUpload = null;
      throw new Error(message);
    }
    drive.uploads++;
    const version = (drive.file?.version ?? 0) + 2;
    drive.file = { id: fileId ?? 'file-1', version, content: structuredClone(content) };
    // Real Drive bumps `version` again when the resumable session finalises, so
    // the response reports a version that is already stale. Reproduced here
    // because trusting it caused phantom "a peer wrote" merges.
    return { id: drive.file.id, version: String(version - 1), modifiedTime: '2026-07-26T00:00:00Z' };
  },
  deleteSyncFile: async () => {
    drive.file = null;
  }
}));

const {
  pull,
  push,
  syncNow,
  syncOnStart,
  flush,
  markReviewed,
  deleteRemoteFile,
  syncCounts,
  getSyncStatus
} = await import('$lib/driveSync');
const { getSyncActivity, clearSyncActivity } = await import('$lib/syncActivity');
const { db, getMeta } = await import('$lib/db');
const { applyReview } = await import('$lib/srs');
const { buildSyncFile } = await import('$lib/syncFile');
const { addPuzzleCard, DAY, resetDb } = await import('./helpers');

describe('drive sync orchestration', () => {
  beforeEach(async () => {
    await resetDb();
    drive.reset();
  });

  it('creates the file on a first push', async () => {
    const id = await addPuzzleCard('p1', Date.now() - DAY, Date.now() - DAY);
    await applyReview(id, 3, null, true, null, null, Date.now());

    const result = await pull(); // nothing there yet
    expect(result.unchanged).toBe(true);
    expect(drive.downloads).toBe(0);

    await push();
    expect(drive.uploads).toBe(1);
    expect(drive.file!.content.events).toHaveLength(1);
    // The settled version, not the stale one the upload response reported.
    expect(await getMeta('drive_last_version')).toBe(String(drive.file!.version));
  });

  it('does not mistake its own upload for a peer write', async () => {
    const id = await addPuzzleCard('p1', Date.now() - DAY, Date.now() - DAY);
    await applyReview(id, 3, null, true, null, null, Date.now());
    await push();

    clearSyncActivity();
    await applyReview(id, 4, null, true, null, null, Date.now() + 1000);
    await push();

    const messages = getSyncActivity().map((e) => e.message);
    expect(messages.some((m) => /Another device wrote/.test(m))).toBe(false);
    expect(drive.downloads).toBe(0);
  });

  it('throttles the app-start sync so a reload per card is not a sync per card', async () => {
    const id = await addPuzzleCard('p1', Date.now() - DAY, Date.now() - DAY);

    await syncOnStart();
    const pullsAfterFirst = drive.uploads + drive.downloads;
    expect(await getMeta('drive_last_pull_at')).toBeDefined();

    // Five cards reviewed, each reloading the document and re-running the
    // app-start sync. None should upload: the batch is not ripe.
    for (let i = 0; i < 5; i++) {
      await applyReview(id, 3, null, true, null, null, Date.now() + i * 1000);
      await markReviewed();
      await syncOnStart();
    }

    expect(drive.uploads).toBe(0);
    expect(drive.uploads + drive.downloads).toBe(pullsAfterFirst);
    expect(await getMeta('drive_pending_count')).toBe('5');

    // Closing the page still gets them out.
    await flush('page close', true);
    expect(drive.uploads).toBe(1);
  });

  it('skips the download when the remote version is unchanged', async () => {
    await push();
    expect(drive.uploads).toBe(1);

    const first = await pull();
    expect(first.unchanged).toBe(true);
    expect(drive.downloads).toBe(0); // version matches what we wrote

    // A peer writes.
    drive.file!.version++;
    const second = await pull();
    expect(second.unchanged).toBe(false);
    expect(drive.downloads).toBe(1);
  });

  it('merges a concurrent peer write instead of clobbering it', async () => {
    const start = Date.now() - 10 * DAY;

    // This device reviews p1 and pushes.
    const local = await addPuzzleCard('p1', start, start);
    await addPuzzleCard('p2', start, start);
    await applyReview(local, 3, null, true, null, null, start + DAY);
    await push();
    expect(drive.file!.content.events).toHaveLength(1);

    // A peer pushes a review of p2 that this device has never seen. Emulated by
    // writing a file built from a different local state.
    const peerFile = structuredClone(drive.file!.content);
    peerFile.events.push({
      event_id: 'peer-event-1',
      device_id: 'peer-device',
      source: 'puzzle',
      puzzle_id: 'p2',
      reviewed_at: start + 2 * DAY,
      rating: 4,
      user_move: null,
      move_accepted: 1,
      centipawn_loss: null,
      duration_ms: null
    });
    drive.file = { id: drive.file!.id, version: drive.file!.version + 1, content: peerFile };

    // This device reviews again locally and pushes without pulling first.
    await applyReview(local, 4, null, true, null, null, start + 3 * DAY);
    await push();

    // The peer's event must survive our overwrite.
    const ids = drive.file!.content.events.map((e) => e.event_id);
    expect(ids).toContain('peer-event-1');
    expect(drive.file!.content.events).toHaveLength(3);
    expect(await db.reviewLog.count()).toBe(3);

    // And it was applied to the local card.
    const p2 = (await db.cards.where('lichess_puzzle_id').equals('p2').first())!;
    expect(p2.reps).toBe(1);
  });

  it('round-trips a full sync between two devices', async () => {
    const start = Date.now() - 20 * DAY;

    const a = await addPuzzleCard('shared', start, start);
    await applyReview(a, 3, null, true, null, null, start + DAY);
    await applyReview(a, 3, null, true, null, null, start + 4 * DAY);
    await syncNow();

    const deviceAState = (await db.cards.get(a))!;

    // Device B: same puzzle from Lichess, no history.
    await resetDb();
    const b = await addPuzzleCard('shared', Date.now(), start);
    await syncNow();

    const deviceBState = (await db.cards.get(b))!;
    expect(deviceBState.reps).toBe(deviceAState.reps);
    expect(deviceBState.due).toBe(deviceAState.due);
    expect(deviceBState.stability).toBe(deviceAState.stability);
    expect(deviceBState.state).toBe(deviceAState.state);
  });

  it('batches reviews instead of uploading one file per card', async () => {
    const id = await addPuzzleCard('p1', Date.now() - DAY, Date.now() - DAY);

    // Nine reviews: under the batch threshold, so nothing should go out. The
    // review page reloads the document after each card, so this state has to
    // survive in storage rather than in a module-level counter.
    for (let i = 0; i < 9; i++) {
      await applyReview(id, 3, null, true, null, null, Date.now() - (9 - i) * 1000);
      await markReviewed();
    }
    expect(drive.uploads).toBe(0);
    expect(await getMeta('drive_pending_count')).toBe('9');

    // A flush that respects the policy still holds off...
    await flush('review batch');
    expect(drive.uploads).toBe(0);

    // ...but the tenth review fills the batch.
    await applyReview(id, 3, null, true, null, null, Date.now());
    await markReviewed();
    expect(drive.uploads).toBe(1);
    expect(await getMeta('drive_pending_count')).toBeUndefined();
    expect(await getMeta('drive_pending_since')).toBeUndefined();
  });

  it('forces a partial batch out when the page is closing', async () => {
    const id = await addPuzzleCard('p1', Date.now() - DAY, Date.now() - DAY);
    await applyReview(id, 3, null, true, null, null, Date.now());
    await markReviewed();
    expect(drive.uploads).toBe(0);

    await flush('page close', true);
    expect(drive.uploads).toBe(1);
    expect(await getMeta('drive_pending_count')).toBeUndefined();
  });

  it('does not upload when there is nothing pending', async () => {
    await flush('page close', true);
    expect(drive.uploads).toBe(0);
  });

  it('deleteRemoteFile removes the file but keeps local history', async () => {
    const id = await addPuzzleCard('p1', Date.now() - DAY, Date.now() - DAY);
    await applyReview(id, 3, null, true, null, null, Date.now());
    await push();

    await deleteRemoteFile();
    expect(drive.file).toBeNull();
    expect(await getMeta('drive_file_id')).toBeUndefined();
    expect((await syncCounts()).events).toBe(1);
  });

  it('logs what the sync fetched, resolved and sent', async () => {
    const start = Date.now() - 10 * DAY;
    const id = await addPuzzleCard('logged', start, start);
    await applyReview(id, 3, null, true, null, null, start + DAY);
    const peerFile = await buildSyncFile();

    // A peer has already written a file this device has never seen.
    await resetDb();
    clearSyncActivity();
    await addPuzzleCard('logged', Date.now(), start);
    drive.file = { id: 'file-1', version: 1, content: peerFile };

    await syncNow();

    const messages = getSyncActivity().map((e) => e.message);
    expect(messages.some((m) => /Checking Drive for changes/.test(m))).toBe(true);
    expect(messages.some((m) => /Downloaded sync file — 1 event/.test(m))).toBe(true);
    expect(messages.some((m) => /Merged 1 new review from other devices/.test(m))).toBe(true);
    expect(messages.some((m) => /Uploading 1 event \(you asked\)/.test(m))).toBe(true);
    expect(messages.some((m) => /Upload complete/.test(m))).toBe(true);

    // Newest first, so the completed upload is at the top.
    expect(getSyncActivity()[0].message).toMatch(/Upload complete/);
  });

  it('logs a failure with the reason rather than a generic message', async () => {
    clearSyncActivity();
    const id = await addPuzzleCard('p1', Date.now() - DAY, Date.now() - DAY);
    await applyReview(id, 3, null, true, null, null, Date.now());
    await markReviewed();

    drive.failNextUpload = 'The Drive API is not enabled for this Google Cloud project';
    await flush('manual', true);

    const failure = getSyncActivity().find((e) => e.level === 'error');
    expect(failure).toBeDefined();
    expect(failure!.detail).toMatch(/Drive API is not enabled/);
    // Not an auth problem, so the UI must not tell the user to reconnect.
    expect(getSyncStatus().needsReconnect).toBe(false);
  });

  it('reports orphan counts for the settings UI', async () => {
    const start = Date.now() - 5 * DAY;
    const id = await addPuzzleCard('gone', start, start);
    await applyReview(id, 3, null, true, null, null, start + DAY);
    const file = await buildSyncFile();

    await resetDb();
    drive.file = { id: 'file-1', version: 1, content: file };
    await pull();

    expect(await syncCounts()).toEqual({ events: 1, orphans: 1 });
  });
});
