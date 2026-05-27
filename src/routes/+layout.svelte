<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let { data, children }: { data: { configured: boolean }; children: Snippet } = $props();

  let reviewSource = $derived(
    page.url.pathname === '/review' ? (page.url.searchParams.get('source') ?? '') : ''
  );

  function onSourceChange(e: Event) {
    const val = (e.currentTarget as HTMLSelectElement).value;
    goto(val ? `/review?source=${val}` : '/review');
  }
</script>

<div class="app">
  <header>
    <a href="/" class="logo">RookRipper</a>
    {#if data.configured}
      <nav>
        <div class="review-nav">
          <a href="/review">Review</a>
          <select value={reviewSource} onchange={onSourceChange}>
            <option value="">All</option>
            <option value="puzzle">Puzzles</option>
            <option value="game">Games</option>
          </select>
        </div>
        <a href="/">Dashboard</a>
        <a href="/settings">Settings</a>
      </nav>
    {/if}
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

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 0;
    border-bottom: 1px solid #333;
    margin-bottom: 1.5rem;
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
