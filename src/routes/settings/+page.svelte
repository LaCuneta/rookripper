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
  import { getMeta, setMeta } from '$lib/db';
  import { playMove, playCapture, playWrong } from '$lib/sound';

  let s = $state<Settings>({ ...DEFAULTS });
  let newCardsPerDay = $state(20);
  let savingLimit = $state(false);

  onMount(async () => {
    s = loadSettings();
    newCardsPerDay = parseInt((await getMeta('new_cards_per_day')) ?? '20') || 0;
  });

  function save() { saveSettings({ ...s }); }

  async function saveLimit() {
    savingLimit = true;
    try {
      const val = Math.max(0, Math.floor(newCardsPerDay));
      await setMeta('new_cards_per_day', String(val));
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
