<script lang="ts">
  import { onMount } from 'svelte';
  import { Chessground } from 'chessground';
  import type { Api } from 'chessground/api';
  import type { Key } from 'chessground/types';
  import 'chessground/assets/chessground.base.css';
  import 'chessground/assets/chessground.brown.css';
  import 'chessground/assets/chessground.cburnett.css';

  let {
    fen,
    orientation = 'white',
    turnColor = 'white',
    lastMove,
    dests,
    interactive = true,
    onMove
  }: {
    fen: string;
    orientation?: 'white' | 'black';
    turnColor?: 'white' | 'black';
    lastMove?: [Key, Key];
    dests?: Map<Key, Key[]>;
    interactive?: boolean;
    onMove?: (orig: Key, dest: Key) => void;
  } = $props();

  let el: HTMLElement;
  let cg: Api | undefined;

  onMount(() => {
    cg = Chessground(el, buildConfig());
    return () => cg?.destroy();
  });

  $effect(() => {
    cg?.set(buildConfig());
  });

  function buildConfig() {
    return {
      fen,
      orientation,
      turnColor,
      lastMove,
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

  export function setPosition(newFen: string, newLastMove?: [Key, Key], newDests?: Map<Key, Key[]>) {
    cg?.set({
      fen: newFen,
      lastMove: newLastMove,
      movable: {
        dests: newDests ?? new Map(),
        events: { after: onMove }
      }
    });
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

  export function clearShapes() {
    cg?.setAutoShapes([]);
  }
</script>

<div bind:this={el} class="cg-wrap"></div>

<style>
  .cg-wrap {
    width: min(480px, 90vw);
    height: min(480px, 90vw);
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
