<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { requestPersistentStorage } from '$lib/db';

  let { data, children }: { data: { configured: boolean }; children: Snippet } = $props();

  // Ask the browser to keep our IndexedDB data durable (reduces eviction risk).
  onMount(() => {
    if (data.configured) requestPersistentStorage();
  });

  let menuOpen = $state(false);

  let reviewSource = $derived(
    page.url.pathname === '/review' ? (page.url.searchParams.get('source') ?? '') : ''
  );

  function onSourceChange(e: Event) {
    const val = (e.currentTarget as HTMLSelectElement).value;
    menuOpen = false;
    goto(val ? `/review?source=${val}` : '/review');
  }
</script>

<div class="app" class:wide={page.url.pathname === '/review'}>
  <header class:open={menuOpen}>
    <button
      class="handle"
      aria-label={menuOpen ? 'Hide menu' : 'Show menu'}
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    ></button>
    <div class="bar">
      <a href="/" class="logo" onclick={() => (menuOpen = false)}>RookRipper</a>
      {#if data.configured}
        <nav>
          <div class="review-nav">
            <a href="/review" onclick={() => (menuOpen = false)}>Review</a>
            <select value={reviewSource} onchange={onSourceChange}>
              <option value="">All</option>
              <option value="puzzle">Puzzles</option>
              <option value="game">Games</option>
            </select>
          </div>
          <a href="/" onclick={() => (menuOpen = false)}>Dashboard</a>
          <a href="/settings" onclick={() => (menuOpen = false)}>Settings</a>
        </nav>
      {/if}
    </div>
  </header>

  <main>
    {@render children()}
  </main>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: #1a1a1a;
    color: #e8e8e8;
    font-family: system-ui, sans-serif;
    min-height: 100dvh;
  }

  :global(a) {
    color: #7eb3e0;
    text-decoration: none;
  }

  :global(a:hover) {
    text-decoration: underline;
  }

  :global(button) {
    cursor: pointer;
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1.2rem;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .app {
    max-width: 600px;
    margin: 0 auto;
    padding: 0 1rem;
  }

  /* The review page gets more room on wide screens so the board can grow
     with the controls moved off to the side. */
  .app.wide {
    max-width: 1100px;
  }

  header {
    position: relative;
    border-bottom: 1px solid #333;
    margin-bottom: 1.5rem;
  }

  /* Desktop: handle is irrelevant; the bar lays out inline as the header. */
  .handle {
    display: none;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 0;
  }

  .logo {
    font-size: 1.2rem;
    font-weight: 700;
    color: #e8e8e8;
  }

  nav {
    display: flex;
    gap: 1.2rem;
    align-items: center;
  }

  @media (max-width: 640px) {
    /* On phones the board + controls below are what matter, so the whole title
       bar collapses to a thin handle. Tapping it pops open a strip — overlaid,
       so it never steals vertical space from the board — with title + nav. */
    header {
      margin-bottom: 0.4rem;
      border-bottom: none;
    }

    .handle {
      display: block;
      width: 100%;
      height: 14px;
      background: none;
      border-radius: 0;
      position: relative;
    }

    /* A small grip so the strip is discoverable without showing the title. */
    .handle::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 2.2rem;
      height: 4px;
      border-radius: 2px;
      background: #444;
    }

    .handle[aria-expanded='true']::before {
      background: #666;
    }

    .bar {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 10;
      flex-wrap: wrap;
      gap: 0.6rem 1.2rem;
      padding: 0.7rem 0.9rem;
      background: #222;
      border: 1px solid #333;
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    }

    header:not(.open) .bar {
      display: none;
    }
  }

  .review-nav {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .review-nav select {
    background: #2a2a2a;
    color: #888;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 0.75rem;
    padding: 0.15rem 0.3rem;
    cursor: pointer;
  }

  .review-nav select:hover {
    border-color: #666;
    color: #bbb;
  }
</style>
