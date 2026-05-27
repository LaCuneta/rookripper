import { json } from '@sveltejs/kit';
import db from '$lib/server/db';

export async function POST() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dateStr = today.toISOString().slice(0, 10);

  const row = db.prepare("SELECT value FROM config WHERE key = 'extra_new_today'").get() as { value: string } | undefined;
  let current = 0;
  if (row) {
    const [d, n] = row.value.split(':');
    if (d === dateStr) current = parseInt(n) || 0;
  }

  const newVal = `${dateStr}:${current + 20}`;
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('extra_new_today', ?)").run(newVal);

  return json({ extra: current + 20 });
}
