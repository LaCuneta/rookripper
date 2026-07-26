import 'fake-indexeddb/auto';

// The sync activity log persists to localStorage (it has to survive the review
// page's reload-per-card). Node has no such global, so provide a minimal one.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    }
  } as Storage;
}

// Dexie needs a structuredClone that handles its own value shapes; Node has one
// globally since 17, so nothing else is required to run the real DB in-process.
