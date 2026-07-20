<script lang="ts">
  import { base } from '$app/paths';
  import { invalidateAll } from '$app/navigation';
  import { syncAll, type SyncProgress } from '$lib/sync';
  import { injectExtraNew } from '$lib/srs';
  import {
    exportData,
    downloadBackup,
    readBackupFile,
    importData,
    deleteAllProgress
  } from '$lib/export';
  import Tip from '$lib/components/Tip.svelte';

  const STATE_HELP: Record<string, string> = {
    new: 'Never reviewed yet. It stays new until it comes up in a session, which is governed by your daily new-card limit.',
    learning:
      'Recently introduced and still being locked in. These come back after minutes or hours rather than days, until they graduate to review.',
    review:
      'Learned. These are scheduled days, weeks or months apart, and the interval grows each time you recall one successfully.',
    relearning:
      'A review card you got wrong. It drops back to short intervals until you have it again — this is a lapse.'
  };

  let { data } = $props();

  let syncing = $state(false);
  let syncMsg = $state('');
  let injecting = $state(false);

  async function injectMore() {
    injecting = true;
    try {
      await injectExtraNew();
      await invalidateAll();
    } finally {
      injecting = false;
    }
  }

  // Puzzles and games sync in parallel, so each gets its own progress row.
  let progress = $state<Record<'puzzles' | 'games', SyncProgress | null>>({
    puzzles: null,
    games: null
  });

  function progressLabel(p: SyncProgress): string {
    const noun = p.source === 'puzzles' ? 'puzzle activity' : 'games';
    if (p.stage === 'fetching') {
      return p.current === 0 ? `Contacting Lichess for ${noun}…` : `Fetched ${p.current} ${noun}…`;
    }
    if (p.stage === 'processing') {
      return `Processing ${p.source} ${p.current} / ${p.total ?? '?'}`;
    }
    return `${p.source}: +${p.current} new card${p.current === 1 ? '' : 's'}`;
  }

  // Fetch has no known total, so the bar is indeterminate until processing.
  function progressPct(p: SyncProgress): number | null {
    if (p.stage === 'done') return 100;
    if (p.stage === 'processing' && p.total) return Math.round((p.current / p.total) * 100);
    if (p.stage === 'processing') return 100;
    return null;
  }

  async function sync() {
    syncing = true;
    syncMsg = '';
    progress = { puzzles: null, games: null };
    try {
      const { puzzles, games } = await syncAll((p) => {
        progress = { ...progress, [p.source]: p };
      });
      // Stats come from the page load function, which won't re-run on its own —
      // without this the dashboard keeps showing pre-sync numbers and no
      // Start Review button. invalidateAll re-runs it in place, so the progress
      // bars and result message stay on screen (a reload would discard them).
      await invalidateAll();
      const total = puzzles.added + games.added;
      syncMsg =
        total === 0
          ? 'Synced — nothing new since last time.'
          : `Synced: +${puzzles.added} puzzles, +${games.added} game cards. Ready to review.`;
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

  let deleting = $state(false);

  async function deleteProgress() {
    const total = grandTotal;
    const warning =
      `Permanently delete all ${total} card${total === 1 ? '' : 's'} and your entire review history?\n\n` +
      `This cannot be undone. Export a backup first if you might want this back.\n\n` +
      `You'll stay signed in to Lichess, and sync cursors reset so a fresh sync ` +
      `can pull your failures again from scratch.`;
    if (!confirm(warning)) return;

    deleting = true;
    backupMsg = '';
    try {
      const res = await deleteAllProgress();
      backupMsg = `Deleted ${res.cards} cards and ${res.reviewLog} reviews.`;
      window.location.reload();
    } catch (err) {
      backupMsg = `Delete failed: ${err instanceof Error ? err.message : err}`;
    } finally {
      deleting = false;
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
    <span class="label">
      <Tip term="due now">
        Cards whose scheduled date has arrived. This is what you'd work through in a
        session right now.
      </Tip>
    </span>
  </div>
  <div class="stat">
    <span class="n">{data.stats.new}</span>
    <span class="label">
      <Tip term="new">{STATE_HELP.new}</Tip>
    </span>
  </div>
  <div class="stat">
    <span class="n">{data.stats.learning}</span>
    <span class="label">
      <Tip term="learning">{STATE_HELP.learning}</Tip>
    </span>
  </div>
</section>

{#if data.stats.due > 0}
  <a href="{base}/review" class="review-btn">Start Review ({data.stats.due})</a>
{:else}
  <p class="empty">No cards due. Check back later or sync for new failures.</p>
{/if}

{#if data.dailyLimit > 0}
  <div class="new-cards-row">
    <span class="new-cards-label">
      <Tip term="New today">
        How many never-before-seen cards have been introduced today, against your daily
        limit. The cap keeps a big backlog from flooding a single session; it doesn't
        limit reviews of cards you've already started.
      </Tip>: {data.newToday} / {data.dailyLimit + data.extraToday}
    </span>
    {#if data.stats.new > 0}
      <button class="inject-btn" onclick={injectMore} disabled={injecting}>
        {injecting ? 'Adding…' : '+ 20 more new'}
      </button>
    {/if}
  </div>
{/if}

<details class="explainer">
  <summary>How spaced repetition works here</summary>

  <p>
    RookRipper turns your own Lichess mistakes into flashcards. Every puzzle you
    failed and every Blunder or Mistake from your analyzed games becomes a
    <strong>card</strong>: the position as it stood just before you went wrong, for you
    to play again.
  </p>

  <h3>The loop</h3>
  <ol>
    <li><strong>Sync</strong> pulls new failures from Lichess and creates cards.</li>
    <li>
      <strong>Review</strong> shows you cards that are <em>due</em>, a few new ones at a
      time, and asks you to find the move.
    </li>
    <li>
      <strong>Rating</strong> happens automatically from how you did — solved instantly,
      solved slowly, or needed hints and retries.
    </li>
    <li>
      <strong>Scheduling</strong> then sets when you'll see the card again. Get it right
      and the gap grows; get it wrong and it shrinks.
    </li>
  </ol>

  <p>
    The point is to meet each position again right as you're about to forget it. That's
    the most efficient moment to reinforce it, so you spend your time on the mistakes
    that haven't stuck rather than the ones that have.
  </p>

  <h3>The words on this page</h3>
  <dl>
    <dt>due</dt>
    <dd>The card's scheduled date has arrived and it's waiting to be reviewed.</dd>

    <dt>new</dt>
    <dd>{STATE_HELP.new}</dd>

    <dt>learning</dt>
    <dd>{STATE_HELP.learning}</dd>

    <dt>review</dt>
    <dd>{STATE_HELP.review}</dd>

    <dt>relearning</dt>
    <dd>{STATE_HELP.relearning}</dd>

    <dt>lapse</dt>
    <dd>
      A card you'd learned but then got wrong. Repeated lapses tell the scheduler the
      position is harder for you than it assumed, and it shortens the intervals.
    </dd>

    <dt>interval</dt>
    <dd>The gap until the next showing — minutes early on, potentially months later.</dd>

    <dt>daily new limit</dt>
    <dd>
      The ceiling on brand-new cards per day (set in Settings). Reviews of cards already
      in progress are never capped, so this controls how fast you take on new material,
      not how much you practice.
    </dd>
  </dl>

  <h3>How you're rated</h3>
  <p>
    Each answer scores <strong>Again</strong>, <strong>Hard</strong>,
    <strong>Good</strong> or <strong>Easy</strong>. Giving up scores Again and the card
    comes back soon. A wrong attempt before finding it scores Hard. Solving cleanly
    scores Good, or Easy if you were fast. Scheduling runs on
    <a href="https://github.com/open-spaced-repetition/ts-fsrs" target="_blank" rel="noopener noreferrer">FSRS</a>,
    which models how likely you are to recall each position and picks the interval that
    lands near the moment you'd otherwise forget it.
  </p>

  <h3>Reading the forecast</h3>
  <p>
    The 30-day chart is your scheduled workload: how many cards come due each day if you
    keep up. New cards aren't included, since they only enter the schedule once you first
    see them.
  </p>
</details>

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
            <td class="state-label">
              <Tip term={st}>{STATE_HELP[st]}</Tip>
            </td>
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
  {#if syncing || progress.puzzles || progress.games}
    <div class="progress-group">
      {#each ['puzzles', 'games'] as const as src}
        {@const p = progress[src]}
        {#if p}
          {@const pct = progressPct(p)}
          <div class="progress-row">
            <span class="progress-label">{progressLabel(p)}</span>
            <div
              class="progress-track"
              role="progressbar"
              aria-valuenow={pct ?? undefined}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="{src} sync progress"
            >
              <div
                class="progress-fill"
                class:indeterminate={pct === null}
                class:done={p.stage === 'done'}
                style={pct === null ? '' : `width: ${pct}%`}
              ></div>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

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
    <button
      class="danger-btn"
      onclick={deleteProgress}
      disabled={deleting || grandTotal === 0}
    >
      {deleting ? 'Deleting…' : 'Delete progress'}
    </button>
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

  .explainer {
    margin: 1.4rem 0;
    padding: 0.6rem 0.9rem;
    background: #1c1c1c;
    border: 1px solid #333;
    border-radius: 5px;
    font-size: 0.85rem;
    line-height: 1.55;
    color: #b0b0b0;
  }

  .explainer summary {
    cursor: pointer;
    color: #ccc;
    font-size: 0.9rem;
    padding: 0.2rem 0;
  }

  .explainer summary:hover {
    color: #7eb3e0;
  }

  .explainer[open] summary {
    margin-bottom: 0.6rem;
    border-bottom: 1px solid #333;
    padding-bottom: 0.5rem;
  }

  .explainer h3 {
    margin: 1.1rem 0 0.35rem;
    font-size: 0.85rem;
    color: #ddd;
  }

  .explainer p {
    margin: 0.5rem 0;
  }

  .explainer ol {
    margin: 0.5rem 0;
    padding-left: 1.2rem;
  }

  .explainer li {
    margin: 0.3rem 0;
  }

  .explainer strong {
    color: #ddd;
  }

  .explainer dl {
    margin: 0.5rem 0 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 0.9rem;
  }

  .explainer dt {
    color: #7eb3e0;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .explainer dd {
    margin: 0;
  }

  @media (max-width: 30rem) {
    .explainer dl {
      grid-template-columns: 1fr;
      gap: 0.1rem;
    }
    .explainer dd {
      margin-bottom: 0.5rem;
    }
  }

  .progress-group {
    margin-top: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .progress-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .progress-label {
    font-size: 0.78rem;
    color: #999;
  }

  .progress-track {
    height: 5px;
    background: #2a2a2a;
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #7eb3e0;
    border-radius: 3px;
    transition: width 0.2s ease;
  }

  .progress-fill.done {
    background: #6dbf67;
  }

  /* No total during the ndjson fetch — slide a partial bar instead of faking a % */
  .progress-fill.indeterminate {
    width: 35%;
    animation: slide 1.1s ease-in-out infinite;
  }

  @keyframes slide {
    0%   { margin-left: -35%; }
    100% { margin-left: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-fill.indeterminate {
      animation: none;
      width: 100%;
      opacity: 0.4;
    }
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

  /* Set apart from export/import — this one is irreversible */
  .backup-row .danger-btn {
    margin-left: auto;
    border-color: #6b3535;
    color: #d08a8a;
  }

  .backup-row .danger-btn:hover:not(:disabled) {
    background: #5c2b2b;
    border-color: #8a4444;
    color: #ffdede;
  }
  .backup-row button:disabled { opacity: 0.5; }
</style>
