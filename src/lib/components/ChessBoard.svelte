<script lang="ts">
  import { onMount } from 'svelte';
  import { Chessground } from 'chessground';
  import type { Api } from 'chessground/api';
  import type { Key } from 'chessground/types';
  import 'chessground/assets/chessground.base.css';
  import 'chessground/assets/chessground.brown.css';
  import 'chessground/assets/chessground.cburnett.css';
  import { BOARD_THEMES, type BoardTheme } from '$lib/settings';

  let {
    fen,
    orientation = 'white',
    turnColor = 'white',
    lastMove,
    dests,
    interactive = true,
    check = false,
    theme = 'brown',
    onMove,
    version = 0
  }: {
    fen: string;
    orientation?: 'white' | 'black';
    turnColor?: 'white' | 'black';
    lastMove?: [Key, Key];
    dests?: Map<Key, Key[]>;
    interactive?: boolean;
    check?: boolean;
    theme?: BoardTheme;
    onMove?: (orig: Key, dest: Key) => void;
    version?: number;
  } = $props();

  const colors = $derived(BOARD_THEMES[theme] ?? BOARD_THEMES.brown);

  let el: HTMLElement;
  let cg: Api | undefined;

  onMount(() => {
    cg = Chessground(el, buildConfig());
    return () => cg?.destroy();
  });

  $effect(() => {
    version; // track version so wrong-move resets trigger a re-run
    cg?.set(buildConfig());
  });

  function buildConfig() {
    return {
      fen,
      orientation,
      turnColor,
      lastMove,
      // chessground marks turnColor's king when `check` is true — the side to
      // move is by definition the side in check.
      check,
      movable: {
        color: interactive ? turnColor : undefined,
        free: false,
        dests: dests ?? new Map(),
        events: { after: onMove }
      },
      animation: { enabled: true, duration: 150 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { enabled: interactive }
    };
  }

  export function lock() {
    cg?.set({ movable: { color: undefined }, draggable: { enabled: false } });
  }

  export function shake() {
    el?.classList.add('wrong');
    setTimeout(() => el?.classList.remove('wrong'), 600);
  }

  export function highlightSquare(square: Key) {
    cg?.setAutoShapes([{ orig: square, brush: 'yellow' }]);
  }

  export function setShapes(shapes: { orig: Key; dest?: Key; brush?: string }[]) {
    cg?.setAutoShapes(shapes);
  }

  export function clearShapes() {
    cg?.setAutoShapes([]);
  }
</script>

<div
  bind:this={el}
  class="cg-wrap themed"
  style="--board-light: {colors.light}; --board-dark: {colors.dark}"
></div>

<style>
  .cg-wrap {
    width: var(--board-size, min(480px, 90vw));
    height: var(--board-size, min(480px, 90vw));
  }

  /* Replace chessground's baked-in brown squares. A conic-gradient tile spans
     2×2 squares, so a 25% background-size tiles to exactly 8×8 with the light
     square landing on a8 — no offsetting needed. */
  :global(.cg-wrap.themed cg-board) {
    background-color: var(--board-light);
    background-image: conic-gradient(
      var(--board-dark) 0deg 90deg,
      var(--board-light) 90deg 180deg,
      var(--board-dark) 180deg 270deg,
      var(--board-light) 270deg 360deg
    );
    background-size: 25% 25%;
  }

  :global(.cg-wrap.wrong) {
    animation: shake 0.5s ease;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%       { transform: translateX(-6px); }
    40%       { transform: translateX(6px); }
    60%       { transform: translateX(-4px); }
    80%       { transform: translateX(4px); }
  }
</style>
