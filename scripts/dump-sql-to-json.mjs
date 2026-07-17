#!/usr/bin/env node
// One-off migration helper: dump the legacy server-side SQLite database
// (data/rookripper.db) into the JSON backup format the client-side app
// imports. Emits the same shape as src/lib/export.ts so the output doubles
// as a restore file.
//
// Usage:
//   node scripts/dump-sql-to-json.mjs [outfile] [--db path/to/rookripper.db]
//
// Requires better-sqlite3 to be installed (it is a dependency of the legacy
// server build). Run this before removing that dependency.

import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
let dbPath = 'data/rookripper.db';
let outFile = 'srs-backup.json';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db') dbPath = args[++i];
  else outFile = args[i];
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('journal_mode = WAL');

const cards = db.prepare('SELECT * FROM cards').all();
const reviewLog = db.prepare('SELECT * FROM review_log').all();

// Only the cursors/limits worth carrying over — never the access token.
const META_KEYS = ['last_puzzle_sync', 'last_game_sync', 'new_cards_per_day', 'extra_new_today'];
const meta = {};
const getConfig = db.prepare('SELECT value FROM config WHERE key = ?');
for (const key of META_KEYS) {
  const row = getConfig.get(key);
  if (row) meta[key] = row.value;
}

const backup = {
  version: 1,
  app: 'rookripper',
  exportedAt: Date.now(),
  cards,
  reviewLog,
  meta
};

writeFileSync(outFile, JSON.stringify(backup, null, 2));
db.close();

console.log(
  `Wrote ${outFile}: ${cards.length} cards, ${reviewLog.length} review-log rows, ` +
    `${Object.keys(meta).length} meta keys.`
);
