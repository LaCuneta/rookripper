<script lang="ts">
  import { syncAll } from '$lib/sync';
  import { injectExtraNew } from '$lib/srs';
  import { exportData, downloadBackup, readBackupFile, importData } from '$lib/export';

  let { data } = $props();

  let syncing = $state(false);
  let syncMsg = $state('');
  let injecting = $state(false);

  async function injectMore() {
    injecting = true;
    try {
      await injectExtraNew();
      window.location.reload();
    } finally {
      injecting = false;
    }
  }

  async function sync() {
    syncing = true;
    syncMsg = '';
    try {
      const { puzzles, games } = await syncAll();
      syncMsg = `Synced: +${puzzles.added} puzzles, +${games.added} game cards`;
    } catch (e) {
      syncMsg = `Error: ${e}`;
    } finally {
      syncing = false;
    }
  }

  // ── Backup / restore ──────────────────────────────────────────────────────
  let importing = $state(false);
  let backupMsg = $state('');
  let fileInput: HTMLInputElement;

  async function exportBackup() {
    downloadBackup(await exportData());
    backupMsg = 'Backup downloaded.';
  }

  async function onImportFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!confirm('Import will replace all current cards and review history. Continue?')) {
      fileInput.value = '';
      return;
    }
    importing = true;
    backupMsg = '';
    try {
      const data = await readBackupFile(file);
      const res = await importData(data, 'replace');
      backupMsg = `Imported ${res.cards} cards, ${res.reviewLog} reviews.`;
      window.location.reload();
    } catch (err) {
      backupMsg = `Import failed: ${err instanceof Error ? err.message : err}`;
    } finally {
      importing = false;
      fileInput.value = '';
    }
  }

  function fmt(ts: number | null) {
    if (!ts) return 'never';
    return new Date(ts).toLocaleString();
  }

  // ── Card breakdown ────────────────────────────────────────────────────────
  type CardState = 'new' | 'learning' | 'review' | 'relearning';
  const STATES: CardState[] = ['new', 'learning', 'review', 'relearning'];

  const bd = $derived.by(() => {
    const r = {
      puzzle: { new: 0, learning: 0, review: 0, relearning: 0 } as Record<CardState, number>,
      game:   { new: 0, learning: 0, review: 0, relearning: 0 } as Record<CardState, number>,
    };
    for (const row of data.cardBreakdown) {
      const src = row.source as 'puzzle' | 'game';
      const st  = row.state  as CardState;
      if (STATES.includes(st)) r[src][st] = row.n;
    }
    return r;
  });

  function rowTotal(st: CardState) { return bd.puzzle[st] + bd.game[st]; }
  const puzzleTotal = $derived(STATES.reduce((s, st) => s + bd.puzzle[st], 0));
  const gameTotal   = $derived(STATES.reduce((s, st) => s + bd.game[st], 0));
  const grandTotal  = $derived(puzzleTotal + gameTotal);

  // ── 14-day forecast ───────────────────────────────────────────────────────
  function dateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function fmtDay(d: Date, i: number): string {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  const forecastDays = $derived.by(() => {
    const fmap = new Map(data.dailyForecast.map((d: {day:string;n:number}) => [d.day, d.n]));
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(t); d.setDate(d.getDate() + i);
      const key = dateKey(d);
      return { label: fmtDay(d, i), n: (fmap.get(key) as number) ?? 0 };
    });
  });

  const maxBar        = $derived(Math.max(...forecastDays.map(d => d.n), 1));
  const scheduledIn30 = $derived(forecastDays.reduce((s, d) => s + d.n, 0));
  const avgPerDay     = $derived(grandTotal > 0 ? (scheduledIn30 / 30).toFixed(1) : '0');
</script>

<svelte:head><title>RookRipper</title></svelte:head>

<section class="stats">
  <div class="stat">
    <span class="n">{data.stats.due}</span>
    <span class="label">due now</span>
  </div>
  <div class="stat">
    <span class="n">{data.stats.new}</span>
    <span class="label">new</span>
  </div>
  <div class="stat">
    <span class="n">{data.stats.learning}</span>
    <span class="label">learning</span>
  </div>
</section>

{#if data.stats.due > 0}
  <a href="/review" class="review-btn">Start Review ({data.stats.due})</a>
{:else}
  <p class="empty">No cards due. Check back later or sync for new failures.</p>
{/if}

{#if data.dailyLimit > 0}
  <div class="new-cards-row">
    <span class="new-cards-label">
      New today: {data.newToday} / {data.dailyLimit + data.extraToday}
    </span>
    {#if data.stats.new > 0}
      <button class="inject-btn" onclick={injectMore} disabled={injecting}>
        {injecting ? 'Adding…' : '+ 20 more new'}
      </button>
    {/if}
  </div>
{/if}

{#if grandTotal > 0}
  <section class="card-stats">
    <h2>Card breakdown</h2>
    <table class="breakdown">
      <thead>
        <tr><th></th><th>Puzzles</th><th>Games</th><th>Total</th></tr>
      </thead>
      <tbody>
        {#each STATES as st}
          <tr class:dim={rowTotal(st) === 0}>
            <td class="state-label">{st}</td>
            <td>{bd.puzzle[st] || '—'}</td>
            <td>{bd.game[st] || '—'}</td>
            <td class="total-col">{rowTotal(st) || '—'}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td class="state-label">total</td>
          <td>{puzzleTotal}</td>
          <td>{gameTotal}</td>
          <td class="total-col">{grandTotal}</td>
        </tr>
      </tfoot>
    </table>

    <h2>Scheduled reviews — next 30 days</h2>
    <p class="forecast-note">
      {scheduledIn30} reviews scheduled · avg {avgPerDay}/day
      {#if bd.puzzle.new + bd.game.new > 0}
        · {bd.puzzle.new + bd.game.new} unstarted cards not shown
      {/if}
    </p>
    <div class="forecast">
      {#each forecastDays as day}
        <div class="bar-row">
          <span class="bar-label">{day.label}</span>
          <span class="bar-track">
            <span class="bar-fill" style="width: {(day.n / maxBar) * 100}%"></span>
          </span>
          <span class="bar-count">{day.n || ''}</span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<section class="sync">
  <h2>Sync</h2>
  <div class="sync-row">
    <div>
      <div>Puzzles: last synced {fmt(data.lastPuzzleSync)}</div>
      <div>Games: last synced {fmt(data.lastGameSync)}</div>
    </div>
    <button onclick={sync} disabled={syncing}>
      {syncing ? 'Syncing…' : 'Sync Now'}
    </button>
  </div>
  {#if syncMsg}
    <p class="sync-msg">{syncMsg}</p>
  {/if}

  {#if data.recentSyncs.length > 0}
    <table class="sync-log">
      <thead>
        <tr><th>Type</th><th>Added</th><th>When</th><th>Status</th></tr>
      </thead>
      <tbody>
        {#each data.recentSyncs as s}
          <tr>
            <td>{s.sync_type}</td>
            <td>{s.items_added ?? '—'}</td>
            <td>{s.completed_at ? fmt(s.completed_at) : '…'}</td>
            <td class:error={!!s.error} title={s.error ?? undefined}>
              {s.error ? s.error.slice(0, 80) + (s.error.length > 80 ? '…' : '') : 'ok'}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<section class="backup">
  <h2>Data &amp; backup</h2>
  <p class="backup-note">
    All your review progress lives in this browser only. Export regularly —
    clearing browsing data or storage eviction will wipe it.
  </p>
  <div class="backup-row">
    <button onclick={exportBackup}>Export backup</button>
    <button onclick={() => fileInput.click()} disabled={importing}>
      {importing ? 'Importing…' : 'Import backup'}
    </button>
    <input
      bind:this={fileInput}
      type="file"
      accept="application/json,.json"
      onchange={onImportFile}
      hidden
    />
  </div>
  {#if backupMsg}
    <p class="sync-msg">{backupMsg}</p>
  {/if}
</section>

<style>
  .stats {
    display: flex;
    gap: 2rem;
    margin-bottom: 1.5rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .n {
    font-size: 2.5rem;
    font-weight: 700;
    line-height: 1;
  }

  .label {
    font-size: 0.8rem;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .review-btn {
    display: inline-block;
    background: #4a90d9;
    color: white;
    padding: 0.7rem 1.8rem;
    border-radius: 6px;
    font-weight: 700;
    font-size: 1.05rem;
    margin-bottom: 2rem;
  }

  .review-btn:hover {
    background: #5aa0e9;
    text-decoration: none;
  }

  .empty {
    color: #888;
    margin-bottom: 2rem;
  }

  .new-cards-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    font-size: 0.85rem;
  }

  .new-cards-label {
    color: #888;
  }

  .inject-btn {
    background: #2a2a2a;
    color: #aaa;
    border: 1px solid #444;
    font-size: 0.8rem;
    font-weight: 400;
    padding: 0.25rem 0.7rem;
  }

  .inject-btn:hover:not(:disabled) { background: #363636; color: #ccc; }
  .inject-btn:disabled { opacity: 0.5; }

  /* ── Card stats ── */
  .card-stats {
    border-top: 1px solid #333;
    padding-top: 1.2rem;
    margin-bottom: 1.5rem;
  }

  .card-stats h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
    margin-bottom: 0.6rem;
    margin-top: 1.2rem;
  }

  .card-stats h2:first-child { margin-top: 0; }

  .breakdown {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    color: #aaa;
    margin-bottom: 1rem;
  }

  .breakdown th {
    text-align: right;
    padding: 0.25rem 0.5rem;
    color: #555;
    font-weight: 400;
    font-size: 0.75rem;
  }

  .breakdown th:first-child { text-align: left; }

  .breakdown td {
    text-align: right;
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid #222;
  }

  .breakdown tfoot td {
    border-top: 1px solid #333;
    border-bottom: none;
    color: #666;
    font-size: 0.8rem;
  }

  .state-label {
    text-align: left !important;
    color: #666;
    text-transform: capitalize;
  }

  .total-col { color: #888; }

  .breakdown tr.dim td { color: #3a3a3a; }

  .forecast-note {
    font-size: 0.75rem;
    color: #555;
    margin-bottom: 0.6rem;
  }

  .forecast { display: flex; flex-direction: column; gap: 0.3rem; }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .bar-label {
    width: 9rem;
    flex-shrink: 0;
    font-size: 0.75rem;
    color: #666;
  }

  .bar-track {
    flex: 1;
    height: 6px;
    background: #242424;
    border-radius: 3px;
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
    background: #3a6ea8;
    border-radius: 3px;
    min-width: 2px;
    transition: width 0.3s ease;
  }

  .bar-count {
    width: 2.5rem;
    text-align: right;
    font-size: 0.75rem;
    color: #555;
  }

  /* ── Sync ── */
  .sync {
    border-top: 1px solid #333;
    padding-top: 1.2rem;
  }

  .sync h2 {
    font-size: 1rem;
    margin-bottom: 0.8rem;
    color: #aaa;
  }

  .sync-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .sync-row div {
    font-size: 0.85rem;
    color: #888;
    line-height: 1.6;
  }

  .sync-row button {
    background: #333;
    color: #e8e8e8;
    white-space: nowrap;
  }

  .sync-row button:hover:not(:disabled) { background: #444; }
  .sync-row button:disabled { opacity: 0.5; }

  .sync-msg {
    margin-top: 0.6rem;
    font-size: 0.85rem;
    color: #aaa;
  }

  .sync-log {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    margin-top: 0.8rem;
    color: #888;
  }

  .sync-log th,
  .sync-log td {
    text-align: left;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid #2a2a2a;
  }

  .sync-log th { color: #666; }
  .sync-log td.error { color: #e07070; }

  /* ── Backup ── */
  .backup {
    border-top: 1px solid #333;
    padding-top: 1.2rem;
    margin-top: 1.5rem;
  }

  .backup h2 {
    font-size: 1rem;
    margin-bottom: 0.6rem;
    color: #aaa;
  }

  .backup-note {
    font-size: 0.8rem;
    color: #888;
    line-height: 1.5;
    margin-bottom: 0.8rem;
  }

  .backup-row {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .backup-row button {
    background: #333;
    color: #e8e8e8;
  }

  .backup-row button:hover:not(:disabled) { background: #444; }
  .backup-row button:disabled { opacity: 0.5; }
</style>
