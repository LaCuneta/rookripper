<script lang="ts">
  let { data } = $props();

  let syncing = $state(false);
  let syncMsg = $state('');

  async function sync() {
    syncing = true;
    syncMsg = '';
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        syncMsg = `Synced: +${json.puzzles.added} puzzles, +${json.games.added} game cards`;
      } else {
        syncMsg = `Error: ${json.error}`;
      }
    } catch (e) {
      syncMsg = `Error: ${e}`;
    } finally {
      syncing = false;
    }
  }

  function fmt(ts: number | null) {
    if (!ts) return 'never';
    return new Date(ts).toLocaleString();
  }
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

  .sync-row button:hover:not(:disabled) {
    background: #444;
  }

  .sync-row button:disabled {
    opacity: 0.5;
  }

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

  .sync-log th {
    color: #666;
  }

  .sync-log td.error {
    color: #e07070;
  }
</style>
