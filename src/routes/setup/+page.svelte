<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { beginLogin, completeLogin, isCallback, isConnected, logout } from '$lib/oauth';
  import { getMeta, requestPersistentStorage } from '$lib/db';

  type Status = 'idle' | 'connecting' | 'error';
  let status = $state<Status>('idle');
  let error = $state('');
  let connected = $state(false);
  let username = $state<string | null>(null);

  onMount(async () => {
    if (isCallback(page.url)) {
      status = 'connecting';
      try {
        username = await completeLogin(page.url);
        await requestPersistentStorage();
        await goto(`${base}/`);
        return;
      } catch (e) {
        status = 'error';
        error = e instanceof Error ? e.message : String(e);
        // Strip code/state from the URL so a refresh doesn't re-run the exchange.
        history.replaceState(null, '', `${base}/setup`);
      }
    }
    connected = await isConnected();
    username = (await getMeta('lichess_username')) ?? null;
  });

  async function connect() {
    status = 'connecting';
    try {
      await beginLogin(); // redirects away
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function disconnect() {
    await logout();
    connected = false;
    username = null;
    status = 'idle';
  }
</script>

<svelte:head><title>Setup · RookRipper</title></svelte:head>

<div class="setup">
  <h1>Connect to Lichess</h1>

  {#if connected && username}
    <p class="connected">Connected as <strong>{username}</strong></p>
    <div class="actions">
      <a class="primary" href="{base}/">Go to dashboard</a>
      <button class="secondary" onclick={disconnect}>Disconnect</button>
    </div>
  {:else}
    <p class="help">
      RookRipper is a fully in-browser app — your puzzles, games, and review
      progress stay on this device. Connect your Lichess account to pull in your
      failed puzzles and analyzed games. We request only the
      <code>puzzle:read</code> scope; your games are public.
    </p>

    {#if status === 'connecting'}
      <p class="status">Connecting to Lichess…</p>
    {:else}
      <button class="primary" onclick={connect}>Connect with Lichess</button>
    {/if}
  {/if}

  {#if status === 'error'}
    <p class="error">{error}</p>
  {/if}
</div>

<style>
  .setup {
    max-width: 440px;
  }

  h1 {
    font-size: 1.4rem;
    margin-bottom: 1rem;
  }

  .connected {
    background: #1e3a24;
    color: #6dbf67;
    padding: 0.5rem 0.8rem;
    border-radius: 4px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .help {
    font-size: 0.85rem;
    color: #888;
    margin-bottom: 1.2rem;
    line-height: 1.6;
  }

  code {
    background: #2a2a2a;
    padding: 0.1em 0.4em;
    border-radius: 3px;
    font-size: 0.85em;
  }

  .actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }

  .primary {
    display: inline-block;
    background: #4a90d9;
    color: white;
    padding: 0.6rem 1.2rem;
    border-radius: 4px;
    font-weight: 600;
  }

  .primary:hover { background: #5aa0e9; text-decoration: none; }

  .secondary {
    background: #333;
    color: #ccc;
  }

  .secondary:hover { background: #444; }

  .status {
    font-size: 0.9rem;
    color: #aaa;
  }

  .error {
    color: #e07070;
    font-size: 0.85rem;
    margin-top: 0.8rem;
  }
</style>
