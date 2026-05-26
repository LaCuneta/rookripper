<script lang="ts">
  import type { Snippet } from 'svelte';

  let { data, children }: { data: { configured: boolean }; children: Snippet } = $props();
</script>

<div class="app">
  <header>
    <a href="/" class="logo">RookRipper</a>
    {#if data.configured}
      <nav>
        <a href="/review">Review</a>
        <a href="/">Dashboard</a>
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
  }
</style>
