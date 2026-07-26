import { getMeta, setMeta } from './db';

// A stable per-device (per-browser-profile) identity. Review events carry it so
// a merged log can be attributed, and so a device can tell its own events from
// a peer's. Never exported and never reconciled — wiping it just makes this
// browser look like a new device, which is harmless.
const DEVICE_ID_KEY = 'device_id';

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  let id = await getMeta(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await setMeta(DEVICE_ID_KEY, id);
  }
  cached = id;
  return id;
}

/** Test seam — drops the in-process cache so a fresh DB yields a fresh id. */
export function resetDeviceIdCache(): void {
  cached = null;
}
