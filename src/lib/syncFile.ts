import { db, getMeta, setMeta } from './db';
import { getDeviceId } from './device';
import { identityKey, ORPHAN_CARD_ID } from './identity';
import { rebuildAllCards } from './replay';
import type { CardSource, ReviewLog } from './types';

// The Drive payload. Lichess is the source of truth for puzzle/game *content*
// (FEN, solutions, PGN), which is large and re-fetchable, so none of it travels.
// Only the review history does — the event stream every device's SRS state is
// derived from. `cards` is a local projection and is never synced.

export const SYNC_FILE_VERSION = 1;

/**
 * A review event, addressed by Lichess identity rather than `card_id`: the
 * latter is a device-local auto-increment and means nothing on another device.
 */
export interface SyncEvent {
  event_id: string;
  device_id: string;
  source: CardSource;
  puzzle_id?: string;
  game_id?: string;
  game_move_number?: number;
  reviewed_at: number;
  rating: number;
  user_move: string | null;
  move_accepted: 0 | 1;
  centipawn_loss: number | null;
  duration_ms: number | null;
}

export interface SyncFile {
  version: number;
  app: 'rookripper';
  exportedAt: number;
  device_id: string;
  events: SyncEvent[];
  meta: Record<string, string>;
  /** Write times for last-writer-wins keys. */
  meta_updated_at?: Record<string, number>;
}

/**
 * Config that is genuinely shared. Tokens and `device_id` are never included.
 *
 * Note what is *absent*: `puzzle_backfill_before` and `puzzle_history_exhausted`
 * describe how much puzzle history **this device** has pulled from Lichess into
 * its local `cards` table. Since `cards` is a local projection and never syncs,
 * adopting a peer's deeper cursor would make this device skip the history in
 * between and silently never create those cards. They stay device-local.
 */
export const SYNC_META_KEYS = [
  'last_puzzle_sync',
  'last_game_sync',
  'new_cards_per_day',
  'extra_new_today'
] as const;

/** Keys reconciled by write time rather than by a value rule. */
const LWW_KEYS = ['new_cards_per_day'] as const;

export function toSyncEvent(row: ReviewLog): SyncEvent {
  const event: SyncEvent = {
    event_id: row.event_id,
    device_id: row.device_id,
    source: row.source,
    reviewed_at: row.reviewed_at,
    rating: row.rating,
    user_move: row.user_move,
    move_accepted: row.move_accepted === 1 ? 1 : 0,
    centipawn_loss: row.centipawn_loss,
    duration_ms: row.duration_ms
  };
  if (row.source === 'puzzle') {
    event.puzzle_id = row.lichess_puzzle_id ?? undefined;
  } else {
    event.game_id = row.lichess_game_id ?? undefined;
    event.game_move_number = row.game_move_number ?? undefined;
  }
  return event;
}

function eventIdentity(event: SyncEvent) {
  return {
    source: event.source,
    lichess_puzzle_id: event.puzzle_id ?? null,
    lichess_game_id: event.game_id ?? null,
    game_move_number: event.game_move_number ?? null
  };
}

export async function buildSyncFile(): Promise<SyncFile> {
  const [rows, deviceId] = await Promise.all([db.reviewLog.toArray(), getDeviceId()]);

  const meta: Record<string, string> = {};
  for (const key of SYNC_META_KEYS) {
    const value = await getMeta(key);
    if (value !== undefined) meta[key] = value;
  }

  const meta_updated_at: Record<string, number> = {};
  for (const key of LWW_KEYS) {
    const stamp = await getMeta(`${key}_updated_at`);
    if (stamp) meta_updated_at[key] = parseInt(stamp);
  }

  return {
    version: SYNC_FILE_VERSION,
    app: 'rookripper',
    exportedAt: Date.now(),
    device_id: deviceId,
    // A row with no identity (its card was deleted pre-migration) can't be
    // correlated on another device, so it stays local.
    events: rows.filter((r) => identityKey(r) !== null).map(toSyncEvent),
    meta,
    meta_updated_at
  };
}

export function assertSyncFile(data: unknown): asserts data is SyncFile {
  const f = data as Partial<SyncFile>;
  if (!f || f.app !== 'rookripper' || !Array.isArray(f.events)) {
    throw new Error('The file in Drive is not a RookRipper sync file.');
  }
  if (typeof f.version === 'number' && f.version > SYNC_FILE_VERSION) {
    throw new Error(
      `The Drive file was written by a newer version of RookRipper (format ${f.version}). Update this device before syncing.`
    );
  }
}

// ── Meta reconciliation ────────────────────────────────────────────────────
type MetaMap = Record<string, string | undefined>;

function maxNumeric(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return parseInt(a) >= parseInt(b) ? a : b;
}

/**
 * `extra_new_today` is "YYYY-MM-DD:N". A later date always wins (the older one
 * is spent); on the same date the larger bonus wins, so a "+20 more" tapped on
 * either device applies on both.
 */
function mergeExtraNew(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const [dateA, nA] = a.split(':');
  const [dateB, nB] = b.split(':');
  if (dateA !== dateB) return dateA > dateB ? a : b;
  return `${dateA}:${Math.max(parseInt(nA) || 0, parseInt(nB) || 0)}`;
}

/**
 * Reconcile shared config. Cursors take the max — they mean "how far through
 * the Lichess timeline this *account* has ingested", which is per-user, not
 * per-device, so adopting a peer's further-along cursor just avoids re-fetching.
 */
export function reconcileMeta(
  local: MetaMap,
  remote: MetaMap,
  localStamps: Record<string, number> = {},
  remoteStamps: Record<string, number> = {}
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of ['last_puzzle_sync', 'last_game_sync'] as const) {
    const merged = maxNumeric(local[key], remote[key]);
    if (merged !== undefined && merged !== local[key]) result[key] = merged;
  }

  const extra = mergeExtraNew(local.extra_new_today, remote.extra_new_today);
  if (extra !== undefined && extra !== local.extra_new_today) result.extra_new_today = extra;

  for (const key of LWW_KEYS) {
    const remoteValue = remote[key];
    if (remoteValue === undefined || remoteValue === local[key]) continue;
    // Only take the peer's value if it was written later than ours. Unstamped
    // (pre-existing) local values lose to a stamped remote one.
    if ((remoteStamps[key] ?? 0) > (localStamps[key] ?? 0)) result[key] = remoteValue;
  }

  return result;
}

// ── Merge ──────────────────────────────────────────────────────────────────
export interface MergeResult {
  eventsAdded: number;
  eventsSkipped: number;
  orphanEvents: number;
  cardsUpdated: number;
  metaChanged: string[];
}

/**
 * Fold a pulled sync file into local state: insert unseen events, reconcile
 * config, then rebuild every card's SRS state from the merged history.
 *
 * Dedup is by `event_id`, so merging is idempotent and order-independent — the
 * same file can be applied any number of times.
 */
export async function mergeSyncFile(remote: SyncFile): Promise<MergeResult> {
  assertSyncFile(remote);

  const result: MergeResult = {
    eventsAdded: 0,
    eventsSkipped: 0,
    orphanEvents: 0,
    cardsUpdated: 0,
    metaChanged: []
  };

  await db.transaction('rw', db.cards, db.reviewLog, async () => {
    const existing = new Set((await db.reviewLog.toArray()).map((r) => r.event_id));

    const localByIdentity = new Map<string, number>();
    for (const card of await db.cards.toArray()) {
      const key = identityKey(card);
      if (key && card.id != null) localByIdentity.set(key, card.id);
    }

    const rows: ReviewLog[] = [];
    for (const event of remote.events) {
      if (!event.event_id || existing.has(event.event_id)) {
        result.eventsSkipped++;
        continue;
      }
      existing.add(event.event_id);

      const identity = eventIdentity(event);
      const key = identityKey(identity);
      if (!key) {
        result.eventsSkipped++;
        continue;
      }

      const cardId = localByIdentity.get(key);
      if (cardId === undefined) result.orphanEvents++;

      rows.push({
        event_id: event.event_id,
        device_id: event.device_id,
        card_id: cardId ?? ORPHAN_CARD_ID,
        ...identity,
        reviewed_at: event.reviewed_at,
        rating: event.rating,
        user_move: event.user_move ?? null,
        move_accepted: event.move_accepted === 1 ? 1 : 0,
        centipawn_loss: event.centipawn_loss ?? null,
        duration_ms: event.duration_ms ?? null
      });
    }

    if (rows.length > 0) await db.reviewLog.bulkAdd(rows);
    result.eventsAdded = rows.length;
  });

  const localMeta: MetaMap = {};
  const localStamps: Record<string, number> = {};
  for (const key of SYNC_META_KEYS) localMeta[key] = await getMeta(key);
  for (const key of LWW_KEYS) {
    const stamp = await getMeta(`${key}_updated_at`);
    if (stamp) localStamps[key] = parseInt(stamp);
  }

  const changes = reconcileMeta(localMeta, remote.meta ?? {}, localStamps, remote.meta_updated_at);
  for (const [key, value] of Object.entries(changes)) {
    await setMeta(key, value);
    if (LWW_KEYS.includes(key as (typeof LWW_KEYS)[number])) {
      await setMeta(`${key}_updated_at`, String(remote.meta_updated_at?.[key] ?? Date.now()));
    }
  }
  result.metaChanged = Object.keys(changes);

  // Only worth replaying when events actually landed; a no-op pull shouldn't
  // rewrite every card row.
  if (result.eventsAdded > 0) {
    result.cardsUpdated = (await rebuildAllCards()).cardsUpdated;
  }

  return result;
}

/** Record a last-writer-wins config write so peers can order it against theirs. */
export async function setSyncedMeta(key: (typeof LWW_KEYS)[number], value: string): Promise<void> {
  await setMeta(key, value);
  await setMeta(`${key}_updated_at`, String(Date.now()));
}
