<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import {
    loadSettings,
    saveSettings,
    DEFAULTS,
    BOARD_THEMES,
    type Settings,
    type BoardTheme
  } from '$lib/settings';

  const themeKeys = Object.keys(BOARD_THEMES) as BoardTheme[];
  import { getMeta } from '$lib/db';
  import { playMove, playCapture, playWrong } from '$lib/sound';
  import { setSyncedMeta } from '$lib/syncFile';
  import { connectGoogle, disconnectGoogle, isGoogleConnected } from '$lib/googleAuth';
  import {
    subscribeSyncStatus,
    initSyncStatus,
    syncNow,
    deleteRemoteFile,
    syncCounts,
    type SyncStatus
  } from '$lib/driveSync';
  import {
    subscribeSyncActivity,
    clearSyncActivity,
    type SyncLogEntry
  } from '$lib/syncActivity';

  let s = $state<Settings>({ ...DEFAULTS });
  let newCardsPerDay = $state(20);
  let savingLimit = $state(false);

  let driveConnected = $state(false);
  let driveBusy = $state(false);
  let driveError = $state<string | null>(null);
  let sync = $state<SyncStatus | null>(null);
  let counts = $state<{ events: number; orphans: number } | null>(null);
  let activity = $state<SyncLogEntry[]>([]);
  let showLog = $state(false);

  onMount(() => {
    s = loadSettings();
    const unsubscribe = subscribeSyncStatus((next) => (sync = next));
    const unsubscribeLog = subscribeSyncActivity((entries) => (activity = entries));

    void (async () => {
      newCardsPerDay = parseInt((await getMeta('new_cards_per_day')) ?? '20') || 0;
      driveConnected = await isGoogleConnected();
      await initSyncStatus();
      counts = await syncCounts();
    })();

    return () => {
      unsubscribe();
      unsubscribeLog();
    };
  });

  async function driveAction(fn: () => Promise<void>) {
    driveBusy = true;
    driveError = null;
    try {
      await fn();
      driveConnected = await isGoogleConnected();
      counts = await syncCounts();
    } catch (err) {
      driveError = err instanceof Error ? err.message : String(err);
    } finally {
      driveBusy = false;
    }
  }

  const relative = (ts: number) => {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  };

  function save() { saveSettings({ ...s }); }

  async function saveLimit() {
    savingLimit = true;
    try {
      const val = Math.max(0, Math.floor(newCardsPerDay));
      // Stamped so a peer can order this write against its own (last writer wins).
      await setSyncedMeta('new_cards_per_day', String(val));
    } finally {
      savingLimit = false;
    }
  }
</script>

<svelte:head><title>Settings · RookRipper</title></svelte:head>

<h1>Settings</h1>

<section>
  <h2>Auto-next</h2>
  <label class="row">
    <input type="checkbox" bind:checked={s.autoNext} onchange={save} />
    Automatically advance after each card
  </label>
  {#if s.autoNext}
    <label class="row indent">
      Countdown duration
      <span class="inline-input">
        <input
          type="number" min="1" max="30" step="1"
          bind:value={s.autoNextSeconds}
          oninput={save}
        /> s
      </span>
    </label>
  {/if}
</section>

<section>
  <h2>Rating thresholds</h2>
  <label class="row">
    Rate as Easy if solved in under
    <span class="inline-input">
      <input
        type="number" min="1" max="120" step="1"
        bind:value={s.easyThresholdMinutes}
        oninput={save}
      /> min
    </span>
  </label>
</section>

<section>
  <h2>New cards per day</h2>
  <label class="row">
    Daily new card limit
    <span class="inline-input">
      <input
        type="number" min="0" max="500" step="5"
        bind:value={newCardsPerDay}
        oninput={saveLimit}
        disabled={savingLimit}
      />
    </span>
  </label>
  <p class="hint">Set to 0 for unlimited. Use "+ 20 more new" on the dashboard for one-time overrides.</p>
</section>

<section>
  <h2>Sync across devices</h2>
  {#if !driveConnected}
    <p class="hint">
      Keep review progress in step across devices via a private Google Drive folder.
      Only your review history is stored — puzzles and games re-download from Lichess,
      and no Lichess or Google token ever leaves this device.
    </p>
    <div class="drive-actions">
      <button type="button" onclick={() => driveAction(connectGoogle)} disabled={driveBusy}>
        {driveBusy ? 'Connecting…' : 'Connect Google Drive'}
      </button>
    </div>
  {:else}
    <div class="sync-status">
      <span class="dot" class:err={sync?.phase === 'error'} class:busy={sync?.phase === 'pulling' || sync?.phase === 'pushing'}></span>
      {#if sync?.phase === 'pulling'}
        Checking for changes…
      {:else if sync?.phase === 'pushing'}
        Uploading…
      {:else if sync?.needsReconnect}
        Google access expired — reconnect to resume syncing.
      {:else if sync?.phase === 'error'}
        Sync failed: {sync.error} (will retry)
      {:else if sync?.pending}
        Changes pending — will sync shortly.
      {:else if sync?.lastSyncedAt}
        Synced {relative(sync.lastSyncedAt)}.
      {:else}
        Connected. Not synced yet.
      {/if}
    </div>

    {#if counts}
      <p class="hint">
        {counts.events} review{counts.events === 1 ? '' : 's'} in the synced history.
        {#if counts.orphans > 0}
          {counts.orphans} waiting on cards this device hasn't pulled from Lichess yet — they
          apply automatically on the next Lichess sync.
        {/if}
      </p>
    {/if}

    <div class="row drive-actions">
      <button type="button" onclick={() => driveAction(syncNow)} disabled={driveBusy}>Sync now</button>
      {#if sync?.needsReconnect}
        <button type="button" onclick={() => driveAction(connectGoogle)} disabled={driveBusy}>Reconnect</button>
      {/if}
      <button type="button" onclick={() => driveAction(disconnectGoogle)} disabled={driveBusy}>Disconnect</button>
      <button
        type="button"
        class="danger"
        disabled={driveBusy}
        onclick={() => {
          if (confirm('Delete the sync file from Google Drive? Review history on this device is kept, but other devices will stop receiving updates.')) {
            void driveAction(deleteRemoteFile);
          }
        }}
      >Delete from Drive</button>
    </div>
    <p class="hint">Disconnecting leaves the file in Drive so you can reconnect later.</p>
  {/if}

  {#if driveError}
    <p class="drive-error">{driveError}</p>
  {/if}

  {#if activity.length > 0}
    <div class="log-head">
      <button type="button" class="log-toggle" onclick={() => (showLog = !showLog)}>
        {showLog ? '▾' : '▸'} Sync activity ({activity.length})
      </button>
      {#if showLog}
        <button type="button" class="log-clear" onclick={clearSyncActivity}>Clear</button>
      {/if}
    </div>

    {#if showLog}
      <ol class="log">
        {#each activity as entry (entry.at + entry.message)}
          <li class={entry.level}>
            <span class="time">{new Date(entry.at).toLocaleTimeString()}</span>
            <span class="msg">
              {entry.message}
              {#if entry.detail}<span class="detail">{entry.detail}</span>{/if}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</section>

<section>
  <h2>Display</h2>
  <label class="row">
    <input type="checkbox" bind:checked={s.showCardType} onchange={save} />
    Show card type (Puzzle / Game)
  </label>
  <label class="row">
    <input type="checkbox" bind:checked={s.sound} onchange={save} />
    Sound effects
  </label>
  {#if s.sound}
    <div class="row indent sound-preview">
      <span class="preview-label">Preview:</span>
      <button type="button" onclick={() => playMove()}>Move</button>
      <button type="button" onclick={() => playCapture()}>Take</button>
      <button type="button" onclick={() => playWrong()}>Wrong</button>
      <a class="lab-link" href="{base}/sounds">Tune sounds →</a>
    </div>
  {/if}

  <fieldset>
    <legend>Board colours</legend>
    <div class="themes">
      {#each themeKeys as key}
        <label class="theme-opt" class:selected={s.boardTheme === key}>
          <input type="radio" bind:group={s.boardTheme} value={key} onchange={save} />
          <span
            class="swatch"
            style="--l: {BOARD_THEMES[key].light}; --d: {BOARD_THEMES[key].dark}"
          ></span>
          <span class="theme-name">{BOARD_THEMES[key].label}</span>
        </label>
      {/each}
    </div>
    <p class="hint">Takes effect on the next card.</p>
  </fieldset>

  <fieldset>
    <legend>Puzzle rating</legend>
    <label class="row">
      <input type="radio" bind:group={s.puzzleRating} value="always" onchange={save} />
      Always show
    </label>
    <label class="row">
      <input type="radio" bind:group={s.puzzleRating} value="after" onchange={save} />
      Show after solving / giving up
    </label>
    <label class="row">
      <input type="radio" bind:group={s.puzzleRating} value="never" onchange={save} />
      Never show
    </label>
  </fieldset>
</section>

<style>
  .sync-status {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.85rem;
    color: #bbb;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4c9a5a;
    flex: none;
  }

  .dot.busy { background: #d8a13a; }
  .dot.err { background: #b4544a; }

  .drive-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  .drive-actions button {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
    background: #2a2a2a;
    color: #ccc;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
  }

  .drive-actions button:hover:not(:disabled) { background: #363636; color: #eee; }
  .drive-actions button:disabled { opacity: 0.5; cursor: default; }
  .drive-actions button.danger { color: #c98079; border-color: #5a3a37; }
  .drive-actions button.danger:hover:not(:disabled) { background: #3a2a28; color: #e0a099; }

  .drive-error {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: #d98d84;
  }

  .log-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.9rem;
  }

  .log-toggle,
  .log-clear {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.78rem;
    color: #888;
    cursor: pointer;
  }

  .log-toggle:hover,
  .log-clear:hover { color: #ccc; }

  .log {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0.4rem 0.5rem;
    max-height: 16rem;
    overflow-y: auto;
    background: #1c1c1c;
    border: 1px solid #333;
    border-radius: 4px;
    font-size: 0.76rem;
    line-height: 1.45;
  }

  .log li {
    display: flex;
    gap: 0.5rem;
    padding: 0.15rem 0;
    color: #999;
  }

  .log li + li { border-top: 1px solid #262626; }

  .log .time {
    flex: none;
    color: #666;
    font-variant-numeric: tabular-nums;
  }

  .log .msg { min-width: 0; }

  .log .detail {
    display: block;
    color: #6d6d6d;
    word-break: break-word;
  }

  .log li.success { color: #8fc79a; }
  .log li.warn { color: #d8b56a; }
  .log li.error { color: #d98d84; }

  .sound-preview {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }

  .preview-label {
    font-size: 0.78rem;
    color: #777;
  }

  .sound-preview button {
    padding: 0.25rem 0.6rem;
    font-size: 0.78rem;
    background: #2a2a2a;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
  }

  .sound-preview button:hover {
    background: #363636;
    color: #ddd;
  }

  .lab-link {
    margin-left: 0.3rem;
    font-size: 0.78rem;
    color: #7eb3e0;
  }

  .lab-link:hover { color: #a8d0f0; }

  .themes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }

  .theme-opt {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem 0.3rem 0.35rem;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.82rem;
    color: #aaa;
  }

  .theme-opt:hover { border-color: #555; color: #ddd; }

  .theme-opt.selected {
    border-color: #7eb3e0;
    color: #e8e8e8;
  }

  .theme-opt input { display: none; }

  /* Same conic tile as the board, at 2x2 squares */
  .swatch {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 3px;
    background-color: var(--l);
    background-image: conic-gradient(
      var(--d) 0deg 90deg,
      var(--l) 90deg 180deg,
      var(--d) 180deg 270deg,
      var(--l) 270deg 360deg
    );
    background-size: 50% 50%;
  }

  .hint {
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    color: #777;
  }

  h1 {
    font-size: 1.2rem;
    margin-bottom: 1.5rem;
  }

  section {
    margin-bottom: 2rem;
  }

  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
    margin-bottom: 0.8rem;
  }

  fieldset {
    border: 1px solid #333;
    border-radius: 4px;
    padding: 0.6rem 0.8rem;
    margin-top: 0.6rem;
  }

  legend {
    font-size: 0.8rem;
    color: #888;
    padding: 0 0.3rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: #ccc;
    padding: 0.3rem 0;
    cursor: pointer;
  }

  .indent {
    padding-left: 1.5rem;
  }

  .inline-input {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-left: auto;
    color: #aaa;
    font-size: 0.85rem;
  }

  input[type="number"] {
    width: 4rem;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #e8e8e8;
    padding: 0.2rem 0.4rem;
    font-size: 0.85rem;
    text-align: right;
  }

  input[type="checkbox"],
  input[type="radio"] {
    accent-color: #4a90d9;
    width: 1rem;
    height: 1rem;
    cursor: pointer;
  }

  .hint {
    font-size: 0.78rem;
    color: #555;
    margin-top: 0.3rem;
    padding-left: 0;
  }
</style>
