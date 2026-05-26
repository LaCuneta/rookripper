<script lang="ts">
  import { untrack } from 'svelte';
  import { Chess } from 'chessops/chess';
  import { parseFen, makeFen } from 'chessops/fen';
  import { parseUci } from 'chessops/util';
  import { chessgroundDests } from 'chessops/compat';
  import type { Key } from 'chessground/types';
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import type { Card } from '$lib/types';

  let { data } = $props();

  // ── Card state ───────────────────────────────────────────────────────────
  // untrack: we intentionally snapshot data on load and mutate locally as the
  // puzzle progresses — reactive tracking of `data` changes is not desired here.
  const initialCard = untrack(() => data.card);
  const initialDests = untrack(() => data.dests);
  const initialTurnColor = untrack(() => data.turnColor as 'white' | 'black');

  let card = $state<Card>(initialCard);
  let dests = $state<Map<Key, Key[]>>(new Map(Object.entries(initialDests) as [Key, Key[]][]));
  let turnColor = $state<'white' | 'black'>(initialTurnColor);
  let currentFen = $state(initialCard.fen);
  let currentLastMove = $state<[Key, Key] | undefined>(
    initialCard.last_move
      ? [initialCard.last_move.slice(0, 2) as Key, initialCard.last_move.slice(2, 4) as Key]
      : undefined
  );

  type Phase = 'playing' | 'evaluating' | 'wrong' | 'complete';
  let phase = $state<Phase>('playing');
  let message = $state('Find the best move.');
  let solutionIndex = $state(0);
  let startedAt = Date.now();
  let board: ChessBoard;
  let gaveUp = $state(false);

  // Parsed solution for puzzle cards
  const solution: string[] = card.source === 'puzzle' ? JSON.parse(card.solution_moves ?? '[]') : [];

  // ── Move handling ────────────────────────────────────────────────────────
  async function onMove(orig: Key, dest: Key) {
    if (phase !== 'playing') return;
    board?.clearShapes();

    const uci = orig + dest;

    if (card.source === 'puzzle') {
      await handlePuzzleMove(uci);
    } else {
      await handleGameMove(uci);
    }
  }

  async function handlePuzzleMove(uci: string) {
    const expected = solution[solutionIndex];

    if (uci !== expected && !isPromotion(uci, expected)) {
      wrongMove('Not the right move. Try again.');
      return;
    }

    // Correct user move — advance position
    const nextFen = applyUci(currentFen, uci);
    if (!nextFen) { wrongMove('Invalid move.'); return; }

    solutionIndex++;
    updatePosition(nextFen, uci);

    if (solutionIndex >= solution.length) {
      phase = 'complete';
      message = 'Solved!';
      board?.lock();
      return;
    }

    // Auto-play computer's response
    const computerUci = solution[solutionIndex];
    await delay(350);
    const afterComputerFen = applyUci(nextFen, computerUci);
    if (!afterComputerFen) { phase = 'complete'; message = 'Solved!'; return; }

    solutionIndex++;
    updatePosition(afterComputerFen, computerUci);

    if (solutionIndex >= solution.length) {
      phase = 'complete';
      message = 'Solved!';
      board?.lock();
    } else {
      message = 'Keep going.';
    }
  }

  async function handleGameMove(uci: string) {
    // Exact best move — immediately accept
    if (uci === card.best_move) {
      phase = 'complete';
      message = 'Best move!';
      updatePosition(applyUci(currentFen, uci) ?? currentFen, uci);
      board?.lock();
      return;
    }

    // Same blunder as original — reject without cloud eval
    if (uci === card.played_move) {
      wrongMove(`That's the original ${card.judgment?.toLowerCase() ?? 'mistake'}.`);
      return;
    }

    // Ask server to check via cloud eval
    phase = 'evaluating';
    message = 'Checking…';
    board?.lock();

    try {
      const res = await fetch('/api/cloud-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: currentFen, move: uci })
      });
      const json = await res.json();

      if (json.accepted) {
        const suffix = json.centipawn_loss ? ` (−${json.centipawn_loss}cp)` : '';
        phase = 'complete';
        message = `Good enough!${suffix}`;
        updatePosition(applyUci(currentFen, uci) ?? currentFen, uci);
      } else {
        phase = 'playing';
        wrongMove(json.reason ?? 'Not accurate enough. Try again.');
        resetBoard();
      }
    } catch {
      phase = 'playing';
      message = 'Cloud eval unavailable — exact move required.';
      if (uci !== card.best_move) {
        wrongMove('Exact best move required (cloud eval offline).');
        resetBoard();
      }
    }
  }

  function wrongMove(msg: string) {
    message = msg;
    board?.shake();
    phase = 'playing';
    resetBoard();
  }

  function resetBoard() {
    currentFen = card.fen;
    currentLastMove = card.last_move
      ? [card.last_move.slice(0, 2) as Key, card.last_move.slice(2, 4) as Key]
      : undefined;
    recomputeDests(card.fen);
    turnColor = initialTurnColor;
    solutionIndex = 0;
  }

  function updatePosition(fen: string, uciMove: string) {
    currentFen = fen;
    currentLastMove = [uciMove.slice(0, 2) as Key, uciMove.slice(2, 4) as Key];
    recomputeDests(fen);
    turnColor = turnColor === 'white' ? 'black' : 'white';
  }

  function recomputeDests(fen: string) {
    try {
      const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
      dests = chessgroundDests(pos);
    } catch {
      dests = new Map();
    }
  }

  // ── Hint / Give up ───────────────────────────────────────────────────────
  function showHint() {
    const hintUci = card.source === 'puzzle' ? solution[solutionIndex] : card.best_move;
    if (!hintUci) return;
    board?.highlightSquare(hintUci.slice(0, 2) as Key);
  }

  async function giveUp() {
    const answerUci = card.source === 'puzzle' ? solution[solutionIndex] : card.best_move;
    if (!answerUci) return;
    const newFen = applyUci(currentFen, answerUci);
    if (newFen) updatePosition(newFen, answerUci);
    phase = 'complete';
    message = 'Answer revealed.';
    gaveUp = true;
    board?.clearShapes();
    board?.lock();
  }

  // ── Submit rating ────────────────────────────────────────────────────────
  async function rate(rating: 1 | 2 | 3 | 4) {
    await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: card.id,
        rating,
        durationMs: Date.now() - startedAt
      })
    });
    // Reload page to get next card (server redirects if none left)
    window.location.reload();
  }

  // ── Utilities ────────────────────────────────────────────────────────────
  function applyUci(fen: string, uci: string): string | null {
    try {
      const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
      const move = parseUci(uci);
      if (!move) return null;
      pos.play(move);
      return makeFen(pos.toSetup());
    } catch {
      return null;
    }
  }

  function isPromotion(played: string, expected: string): boolean {
    // Allow any promotion piece if the base move matches
    return played.length === 4 && expected.length === 5 && played === expected.slice(0, 4);
  }

  function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function sourceLabel(): string {
    if (card.source === 'puzzle') {
      return `Puzzle ${card.lichess_puzzle_id} · Rating ${card.puzzle_rating}`;
    }
    return `Game ${card.lichess_game_id} · move ${(card.game_move_number ?? 0) + 1} · ${card.judgment}`;
  }

  function lichessUrl(): string {
    if (card.source === 'puzzle') {
      return `https://lichess.org/training/${card.lichess_puzzle_id}`;
    }
    // #ply jumps to the position before the blunder so the user sees the same position as the card
    return `https://lichess.org/${card.lichess_game_id}#${card.game_move_number ?? 0}`;
  }
</script>

<svelte:head><title>Review · RookRipper</title></svelte:head>

<div class="review">
  <ChessBoard
    bind:this={board}
    fen={currentFen}
    orientation={initialTurnColor}
    {turnColor}
    lastMove={currentLastMove}
    {dests}
    interactive={phase === 'playing'}
    {onMove}
  />

  <div class="info">
    <div class="source">
      {sourceLabel()}
      <a href={lichessUrl()} target="_blank" rel="noopener noreferrer" class="lichess-link">
        Open on Lichess ↗
      </a>
    </div>
    <div class="message" class:correct={phase === 'complete'} class:wrong={phase === 'wrong'}>
      {message}
    </div>
  </div>

  {#if phase === 'playing'}
    <div class="action-buttons">
      <button class="hint-btn" onclick={showHint}>Hint</button>
      <button class="giveup-btn" onclick={giveUp}>Give Up</button>
    </div>
  {/if}

  {#if phase === 'complete'}
    <div class="rating-buttons">
      <p class="rating-prompt">{gaveUp ? 'Mark as missed.' : 'How well did you recall this?'}</p>
      <div class="buttons">
        <button class="again"  onclick={() => rate(1)}>Again</button>
        {#if !gaveUp}
          <button class="hard"   onclick={() => rate(2)}>Hard</button>
          <button class="good"   onclick={() => rate(3)}>Good</button>
          <button class="easy"   onclick={() => rate(4)}>Easy</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .review {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.2rem;
  }

  .info {
    width: min(480px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .source {
    font-size: 0.8rem;
    color: #666;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .lichess-link {
    font-size: 0.75rem;
    color: #555;
    white-space: nowrap;
  }

  .lichess-link:hover {
    color: #aaa;
  }

  .message {
    font-size: 1rem;
    color: #aaa;
    min-height: 1.4rem;
    transition: color 0.2s;
  }

  .message.correct {
    color: #6dbf67;
  }

  .message.wrong {
    color: #e07070;
  }

  .rating-buttons {
    width: min(480px, 90vw);
  }

  .rating-prompt {
    font-size: 0.85rem;
    color: #888;
    margin-bottom: 0.6rem;
  }

  .buttons {
    display: flex;
    gap: 0.5rem;
  }

  .buttons button {
    flex: 1;
    padding: 0.6rem 0;
    font-size: 0.9rem;
  }

  .action-buttons {
    width: min(480px, 90vw);
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .hint-btn, .giveup-btn {
    padding: 0.4rem 0.9rem;
    font-size: 0.8rem;
    background: #2a2a2a;
    color: #999;
    border: 1px solid #444;
  }

  .hint-btn:hover   { background: #363636; color: #ccc; }
  .giveup-btn:hover { background: #363636; color: #e07070; }

  .again  { background: #8b3030; color: #fff; }
  .hard   { background: #7a5a20; color: #fff; }
  .good   { background: #2e6e3e; color: #fff; }
  .easy   { background: #1e5080; color: #fff; }

  .again:hover  { background: #a03838; }
  .hard:hover   { background: #906a28; }
  .good:hover   { background: #38864e; }
  .easy:hover   { background: #266098; }
</style>
