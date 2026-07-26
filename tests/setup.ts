import 'fake-indexeddb/auto';

// Dexie needs a structuredClone that handles its own value shapes; Node has one
// globally since 17, so nothing else is required to run the real DB in-process.
