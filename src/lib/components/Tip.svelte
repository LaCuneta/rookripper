<script lang="ts">
  import type { Snippet } from 'svelte';

  let { term, children }: { term: string; children: Snippet } = $props();

  let open = $state(false);
</script>

<span class="tip-wrap">
  <button
    type="button"
    class="tip-term"
    aria-expanded={open}
    onclick={() => (open = !open)}
    onmouseenter={() => (open = true)}
    onmouseleave={() => (open = false)}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    onkeydown={(e) => e.key === 'Escape' && (open = false)}
  >{term}</button>
  {#if open}
    <span class="tip-pop" role="tooltip">{@render children()}</span>
  {/if}
</span>

<style>
  .tip-wrap {
    position: relative;
    display: inline-block;
  }

  .tip-term {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: help;
    border-bottom: 1px dotted #777;
  }

  .tip-term:hover,
  .tip-term:focus-visible {
    color: #7eb3e0;
    border-bottom-color: #7eb3e0;
    outline: none;
  }

  .tip-pop {
    position: absolute;
    left: 0;
    top: calc(100% + 0.4rem);
    z-index: 50;
    width: max-content;
    max-width: 16rem;
    padding: 0.5rem 0.65rem;
    background: #1f1f1f;
    border: 1px solid #444;
    border-radius: 4px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
    font-size: 0.78rem;
    font-weight: normal;
    line-height: 1.45;
    color: #ccc;
    text-align: left;
    text-transform: none;
    white-space: normal;
    pointer-events: none;
  }

  /* Keep the popup on-screen for terms near the right edge */
  @media (max-width: 30rem) {
    .tip-pop {
      left: auto;
      right: 0;
    }
  }
</style>
