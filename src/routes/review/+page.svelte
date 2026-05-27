<script lang="ts">
  import { untrack } from 'svelte';
  import { Chess } from 'chessops/chess';
  import { parseFen, makeFen } from 'chessops/fen';
  import { parseUci } from 'chessops/util';
  import { chessgroundDests } from 'chessops/compat';
  import type { Key } from 'chessground/types';
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import type { Card } from '$lib/types';
  import { loadSettings } from '$lib/settings';

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

  type Phase = 'playing' | 'evaluating' | 'complete';
  let phase = $state<Phase>('playing');
  let message = $state('Find the best move.');
  let solutionIndex = $state(0);
  let startedAt = Date.now();
  let hadWrongAttempt = $state(false);
  let pendingRating = $state<1 | 2 | 3 | 4 | null>(null);
  let countdown = $state<number | null>(null);
  let orientation = $state<'white' | 'black'>(initialTurnColor);
  let board: ChessBoard;
  let boardVersion = $state(0);

  const settings = loadSettings();

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
      complete('Solved!');
      return;
    }

    // Auto-play computer's response
    const computerUci = solution[solutionIndex];
    await delay(350);
    const afterComputerFen = applyUci(nextFen, computerUci);
    if (!afterComputerFen) { complete('Solved!'); return; }

    solutionIndex++;
    updatePosition(afterComputerFen, computerUci);

    if (solutionIndex >= solution.length) {
      complete('Solved!');
    } else {
      message = 'Keep going.';
    }
  }

  async function handleGameMove(uci: string) {
    // Exact best move — immediately accept
    if (uci === card.best_move) {
      updatePosition(applyUci(currentFen, uci) ?? currentFen, uci);
      showBlunderArrow();
      complete('Best move!');
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
        updatePosition(applyUci(currentFen, uci) ?? currentFen, uci);
        showBlunderArrow();
        complete(`Good enough!${suffix}`);
      } else {
        phase = 'playing';
        wrongMove(json.reason ?? 'Not accurate enough. Try again.');
      }
    } catch {
      phase = 'playing';
      if (uci !== card.best_move) {
        wrongMove('Exact best move required (cloud eval offline).');
      }
    }
  }

  function wrongMove(msg: string) {
    hadWrongAttempt = true;
    message = msg;
    board?.shake();
    boardVersion++;
    phase = 'playing';
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

  function showBlunderArrow() {
    const pm = card.played_move;
    if (!pm || pm.length < 4) return;
    board?.setShapes([{ orig: pm.slice(0, 2) as Key, dest: pm.slice(2, 4) as Key, brush: 'red' }]);
  }

  // ── Hint / Give up ───────────────────────────────────────────────────────
  function showHint() {
    const hintUci = card.source === 'puzzle' ? solution[solutionIndex] : card.best_move;
    if (!hintUci) return;
    board?.highlightSquare(hintUci.slice(0, 2) as Key);
  }

  function giveUp() {
    const answerUci = card.source === 'puzzle' ? solution[solutionIndex] : card.best_move;
    if (!answerUci) return;
    const newFen = applyUci(currentFen, answerUci);
    if (newFen) updatePosition(newFen, answerUci);
    board?.clearShapes();
    board?.lock();
    complete('Answer revealed.', 1); // Again
  }

  // ── Rating ───────────────────────────────────────────────────────────────
  function complete(msg: string, forcedRating?: 1 | 2 | 3 | 4) {
    phase = 'complete';
    message = msg;
    board?.lock();
    pendingRating = forcedRating ?? computeRating();
    if (settings.autoNext) startCountdown(settings.autoNextSeconds);
  }

  function computeRating(): 1 | 2 | 3 | 4 {
    if (hadWrongAttempt) return 2;
    if (Date.now() - startedAt < settings.easyThresholdMinutes * 60 * 1000) return 4;
    return 3;
  }

  async function startCountdown(totalSecs: number) {
    let secs = totalSecs;
    countdown = secs;
    while (secs > 0) {
      await delay(1000);
      secs--;
      countdown = secs > 0 ? secs : null;
    }
    await next();
  }

  async function next() {
    if (pendingRating === null) return;
    countdown = null;
    await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: card.id, rating: pendingRating, durationMs: Date.now() - startedAt })
    });
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

  const RATING_LABELS: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
  const ratingLabel = $derived(pendingRating !== null ? RATING_LABELS[pendingRating] : '');

  const sourceLabel = $derived(computeSourceLabel());
  function computeSourceLabel(): string {
    const revealed = settings.showCardType || phase === 'complete';
    if (card.source === 'puzzle') {
      const prefix = revealed ? 'Puzzle ' : '';
      const showRating = settings.puzzleRating === 'always'
        || (settings.puzzleRating === 'after' && phase === 'complete');
      const rating = showRating && card.puzzle_rating ? ` · Rating ${card.puzzle_rating}` : '';
      return `${prefix}${card.lichess_puzzle_id}${rating}`;
    }
    if (!revealed) return card.lichess_game_id ?? '';
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

<svelte:window onkeydown={(e) => {
  if (e.key === 'f') orientation = orientation === 'white' ? 'black' : 'white';
  if (e.key === 'n' && phase === 'complete') next();
}} />

<div class="review">
  <ChessBoard
    bind:this={board}
    fen={currentFen}
    {orientation}
    {turnColor}
    lastMove={currentLastMove}
    {dests}
    interactive={phase === 'playing'}
    {onMove}
    version={boardVersion}
  />

  <div class="info">
    <div class="source">
      {sourceLabel}
      <a href={lichessUrl()} target="_blank" rel="noopener noreferrer" class="lichess-link">
        Open on Lichess ↗
      </a>
    </div>
    <div class="message" class:correct={phase === 'complete'}>
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
    <div class="action-buttons">
      <span class="rating-label" data-rating={ratingLabel}>{ratingLabel}</span>
      <button class="next-btn" onclick={next}>
        {countdown !== null ? `Next in ${countdown}s` : 'Next →'}
      </button>
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

  .rating-label {
    font-size: 0.8rem;
    margin-right: auto;
    color: #555;
  }
  .rating-label[data-rating="Easy"]  { color: #6dbf67; }
  .rating-label[data-rating="Good"]  { color: #7eb3e0; }
  .rating-label[data-rating="Hard"]  { color: #d4a04a; }
  .rating-label[data-rating="Again"] { color: #e07070; }

  .next-btn {
    padding: 0.4rem 0.9rem;
    font-size: 0.85rem;
    background: #2a2a2a;
    color: #ccc;
    border: 1px solid #555;
  }

  .next-btn:hover { background: #363636; color: #e8e8e8; }
</style>
