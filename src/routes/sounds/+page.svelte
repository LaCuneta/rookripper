<script lang="ts">
  import { onMount } from 'svelte';
  import {
    DEFAULT_SOUND,
    loadSoundParams,
    saveSoundParams,
    resetSoundParams,
    playMove,
    playCapture,
    playWrong,
    type SoundParams
  } from '$lib/sound';

  let p = $state<SoundParams>(structuredClone(DEFAULT_SOUND));
  let loaded = $state(false);

  onMount(() => {
    p = structuredClone(loadSoundParams());
    loaded = true;
  });

  // $state.snapshot, not structuredClone: p is a reactive proxy and structured
  // cloning a Proxy throws.
  function persist() {
    saveSoundParams($state.snapshot(p));
  }

  // Persist on every change so the review page picks up the same values.
  function commit(play?: 'move' | 'capture' | 'wrong') {
    persist();
    if (play === 'move') playMove();
    if (play === 'capture') playCapture();
    if (play === 'wrong') playWrong();
  }

  function reset() {
    resetSoundParams();
    p = structuredClone(DEFAULT_SOUND);
  }

  // Preset partial sets — the ratios are what make a hit read as wood vs metal.
  const PARTIAL_PRESETS = [
    { label: 'Wooden bar', value: [1, 2.76, 5.4] },
    { label: 'Dense block', value: [1, 3.2, 6.1] },
    { label: 'Hollow / boxy', value: [1, 2.1, 3.4] },
    { label: 'Soft thud', value: [1, 2.4] },
    { label: 'Bell-like', value: [1, 2, 3, 4.2] }
  ];

  function setPartials(kind: 'move' | 'capture', value: number[]) {
    p[kind].partials = [...value];
    commit(kind);
  }

  function partialsMatch(a: number[], b: number[]) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  const woodFields = [
    { key: 'freq', label: 'Fundamental', min: 80, max: 1200, step: 5, unit: 'Hz',
      hint: 'Lower = bigger, heavier piece' },
    { key: 'decay', label: 'Ring time', min: 0.02, max: 0.5, step: 0.005, unit: 's',
      hint: 'How long the wood rings' },
    { key: 'decayScale', label: 'Mode damping', min: 1, max: 3, step: 0.05, unit: '×',
      hint: 'Higher = upper partials die faster (duller)' },
    { key: 'click', label: 'Contact click', min: 0, max: 0.8, step: 0.01, unit: '',
      hint: 'Low = soft landing, high = sharp crack' },
    { key: 'clickTone', label: 'Click tone', min: 400, max: 6000, step: 50, unit: 'Hz',
      hint: 'Brightness of the strike' },
    { key: 'gain', label: 'Volume', min: 0, max: 1, step: 0.02, unit: '' }
  ] as const;

  const wrongFields = [
    { key: 'freq', label: 'Start pitch', min: 60, max: 500, step: 5, unit: 'Hz' },
    { key: 'endFreq', label: 'End pitch', min: 40, max: 500, step: 5, unit: 'Hz' },
    { key: 'dur', label: 'Length', min: 0.05, max: 0.6, step: 0.01, unit: 's' },
    { key: 'tremolo', label: 'Buzz rate', min: 10, max: 120, step: 1, unit: 'Hz',
      hint: 'The "bzzt" rasp' },
    { key: 'lowpass', label: 'Softness', min: 200, max: 4000, step: 50, unit: 'Hz',
      hint: 'Lower = duller and gentler' },
    { key: 'gain', label: 'Volume', min: 0, max: 0.6, step: 0.01, unit: '' }
  ] as const;

  let copied = $state(false);
  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify($state.snapshot(p), null, 2));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
</script>

<svelte:head><title>Sound lab · RookRipper</title></svelte:head>

<h1>Sound lab</h1>
<p class="intro">
  Tweak until they're right. Changes save immediately and apply to reviews — no reload
  needed. Every slider replays the sound as you release it.
</p>

{#if loaded}
  {#each [{ kind: 'move', title: 'Move' }, { kind: 'capture', title: 'Take' }] as const as s}
    <section>
      <div class="head">
        <h2>{s.title}</h2>
        <button class="play" onclick={() => (s.kind === 'move' ? playMove() : playCapture())}>
          ▶ Play
        </button>
      </div>

      <div class="presets">
        {#each PARTIAL_PRESETS as preset}
          <button
            class="preset"
            class:on={partialsMatch(p[s.kind].partials, preset.value)}
            onclick={() => setPartials(s.kind, preset.value)}
          >{preset.label}</button>
        {/each}
      </div>

      {#each woodFields as f}
        <label class="field">
          <span class="name">
            {f.label}
            {#if 'hint' in f}<em>{f.hint}</em>{/if}
          </span>
          <input
            type="range"
            min={f.min}
            max={f.max}
            step={f.step}
            bind:value={p[s.kind][f.key]}
            oninput={persist}
            onchange={() => commit(s.kind)}
          />
          <span class="val">{p[s.kind][f.key]}{f.unit}</span>
        </label>
      {/each}
    </section>
  {/each}

  <section>
    <div class="head">
      <h2>Wrong move</h2>
      <button class="play" onclick={() => playWrong()}>▶ Play</button>
    </div>
    {#each wrongFields as f}
      <label class="field">
        <span class="name">
          {f.label}
          {#if 'hint' in f}<em>{f.hint}</em>{/if}
        </span>
        <input
          type="range"
          min={f.min}
          max={f.max}
          step={f.step}
          bind:value={p.wrong[f.key]}
          oninput={persist}
          onchange={() => commit('wrong')}
        />
        <span class="val">{p.wrong[f.key]}{f.unit}</span>
      </label>
    {/each}
  </section>

  <div class="actions">
    <button onclick={reset}>Reset to defaults</button>
    <button onclick={copyJson}>{copied ? 'Copied!' : 'Copy values as JSON'}</button>
  </div>
  <p class="hint-note">
    Once these sound right, copy the JSON and hand it over — the numbers can be baked in
    as the new defaults so they survive clearing browser storage.
  </p>
{/if}

<style>
  .intro {
    color: #999;
    font-size: 0.85rem;
    max-width: 40rem;
  }

  section {
    margin: 1.4rem 0;
    padding: 0.9rem 1rem;
    background: #1c1c1c;
    border: 1px solid #333;
    border-radius: 5px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.7rem;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    color: #ddd;
  }

  .play, .actions button, .preset {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
    background: #2a2a2a;
    color: #bbb;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
  }

  .play:hover, .actions button:hover, .preset:hover {
    background: #383838;
    color: #eee;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.8rem;
  }

  .preset.on {
    border-color: #7eb3e0;
    color: #e8e8e8;
  }

  .field {
    display: grid;
    grid-template-columns: 13rem 1fr 4.5rem;
    align-items: center;
    gap: 0.7rem;
    margin: 0.35rem 0;
    font-size: 0.82rem;
    color: #aaa;
  }

  .name {
    display: flex;
    flex-direction: column;
  }

  .name em {
    font-style: normal;
    font-size: 0.7rem;
    color: #666;
  }

  .val {
    text-align: right;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #7eb3e0;
  }

  input[type='range'] {
    width: 100%;
    accent-color: #7eb3e0;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .hint-note {
    margin-top: 0.6rem;
    font-size: 0.78rem;
    color: #777;
    max-width: 40rem;
  }

  @media (max-width: 40rem) {
    .field {
      grid-template-columns: 1fr 3.5rem;
    }
    .name { grid-column: 1 / -1; }
  }
</style>
