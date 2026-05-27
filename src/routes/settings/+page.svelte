<script lang="ts">
  import { onMount } from 'svelte';
  import { loadSettings, saveSettings, DEFAULTS, type Settings } from '$lib/settings';

  let s = $state<Settings>({ ...DEFAULTS });
  let newCardsPerDay = $state(20);
  let savingLimit = $state(false);

  onMount(async () => {
    s = loadSettings();
    const res = await fetch('/api/settings');
    const json = await res.json();
    newCardsPerDay = json.newCardsPerDay;
  });

  function save() { saveSettings({ ...s }); }

  async function saveLimit() {
    savingLimit = true;
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCardsPerDay })
      });
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
  <h2>Display</h2>
  <label class="row">
    <input type="checkbox" bind:checked={s.showCardType} onchange={save} />
    Show card type (Puzzle / Game)
  </label>
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
