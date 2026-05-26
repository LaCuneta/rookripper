import { K as bind_props, a7 as run, _ as head, V as escape_html, J as attr_class } from "../../../chunks/renderer.js";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { chessgroundDests } from "chessops/compat";
import "chessground";
function ChessBoard($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      fen,
      orientation = "white",
      turnColor = "white",
      lastMove,
      dests,
      interactive = true,
      onMove
    } = $$props;
    let el;
    function setPosition(newFen, newLastMove, newDests) {
    }
    function lock() {
    }
    function shake() {
      setTimeout(() => el?.classList.remove("wrong"), 600);
    }
    $$renderer2.push(`<div class="cg-wrap svelte-sb3f9s"></div>`);
    bind_props($$props, { setPosition, lock, shake });
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const initialCard = run(() => data.card);
    const initialDests = run(() => data.dests);
    const initialTurnColor = run(() => data.turnColor);
    let card = initialCard;
    let dests = new Map(Object.entries(initialDests));
    let turnColor = initialTurnColor;
    let currentFen = initialCard.fen;
    let currentLastMove = initialCard.last_move ? [
      initialCard.last_move.slice(0, 2),
      initialCard.last_move.slice(2, 4)
    ] : void 0;
    let phase = "playing";
    let message = "Find the best move.";
    let solutionIndex = 0;
    const solution = card.source === "puzzle" ? JSON.parse(card.solution_moves ?? "[]") : [];
    async function onMove(orig, dest) {
      if (phase !== "playing") return;
      const uci = orig + dest;
      if (card.source === "puzzle") {
        await handlePuzzleMove(uci);
      } else {
        await handleGameMove(uci);
      }
    }
    async function handlePuzzleMove(uci) {
      const expected = solution[solutionIndex];
      if (uci !== expected && !isPromotion(uci, expected)) {
        wrongMove("Not the right move. Try again.");
        return;
      }
      const nextFen = applyUci(currentFen, uci);
      if (!nextFen) {
        wrongMove("Invalid move.");
        return;
      }
      solutionIndex++;
      updatePosition(nextFen, uci);
      if (solutionIndex >= solution.length) {
        phase = "complete";
        message = "Solved!";
        return;
      }
      const computerUci = solution[solutionIndex];
      await delay(350);
      const afterComputerFen = applyUci(nextFen, computerUci);
      if (!afterComputerFen) {
        phase = "complete";
        message = "Solved!";
        return;
      }
      solutionIndex++;
      updatePosition(afterComputerFen, computerUci);
      if (solutionIndex >= solution.length) {
        phase = "complete";
        message = "Solved!";
      } else {
        message = "Keep going.";
      }
    }
    async function handleGameMove(uci) {
      if (uci === card.best_move) {
        phase = "complete";
        message = "Best move!";
        updatePosition(applyUci(currentFen, uci) ?? currentFen, uci);
        return;
      }
      if (uci === card.played_move) {
        wrongMove(`That's the original ${card.judgment?.toLowerCase() ?? "mistake"}.`);
        return;
      }
      phase = "evaluating";
      message = "Checking…";
      try {
        const res = await fetch("/api/cloud-eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen: currentFen, move: uci })
        });
        const json = await res.json();
        if (json.accepted) {
          const suffix = json.centipawn_loss ? ` (−${json.centipawn_loss}cp)` : "";
          phase = "complete";
          message = `Good enough!${suffix}`;
          updatePosition(applyUci(currentFen, uci) ?? currentFen, uci);
        } else {
          phase = "playing";
          wrongMove(json.reason ?? "Not accurate enough. Try again.");
          resetBoard();
        }
      } catch {
        phase = "playing";
        message = "Cloud eval unavailable — exact move required.";
        if (uci !== card.best_move) {
          wrongMove("Exact best move required (cloud eval offline).");
          resetBoard();
        }
      }
    }
    function wrongMove(msg) {
      message = msg;
      phase = "playing";
      resetBoard();
    }
    function resetBoard() {
      currentFen = card.fen;
      currentLastMove = card.last_move ? [card.last_move.slice(0, 2), card.last_move.slice(2, 4)] : void 0;
      recomputeDests(card.fen);
    }
    function updatePosition(fen, uciMove) {
      currentFen = fen;
      currentLastMove = [uciMove.slice(0, 2), uciMove.slice(2, 4)];
      recomputeDests(fen);
      turnColor = turnColor === "white" ? "black" : "white";
    }
    function recomputeDests(fen) {
      try {
        const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
        dests = chessgroundDests(pos);
      } catch {
        dests = /* @__PURE__ */ new Map();
      }
    }
    function applyUci(fen, uci) {
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
    function isPromotion(played, expected) {
      return played.length === 4 && expected.length === 5 && played === expected.slice(0, 4);
    }
    function delay(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }
    function sourceLabel() {
      if (card.source === "puzzle") {
        return `Puzzle ${card.lichess_puzzle_id} · Rating ${card.puzzle_rating}`;
      }
      return `Game ${card.lichess_game_id} · move ${(card.game_move_number ?? 0) + 1} · ${card.judgment}`;
    }
    head("1mr7uv1", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>Review · RookRipper</title>`);
      });
    });
    $$renderer2.push(`<div class="review svelte-1mr7uv1">`);
    ChessBoard($$renderer2, {
      fen: currentFen,
      orientation: turnColor,
      turnColor,
      lastMove: currentLastMove,
      dests,
      interactive: phase === "playing",
      onMove
    });
    $$renderer2.push(`<!----> <div class="info svelte-1mr7uv1"><div class="source svelte-1mr7uv1">${escape_html(sourceLabel())}</div> <div${attr_class("message svelte-1mr7uv1", void 0, { "correct": phase === "complete", "wrong": phase === "wrong" })}>${escape_html(message)}</div></div> `);
    if (phase === "complete") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="rating-buttons svelte-1mr7uv1"><p class="rating-prompt svelte-1mr7uv1">How well did you recall this?</p> <div class="buttons svelte-1mr7uv1"><button class="again svelte-1mr7uv1">Again</button> <button class="hard svelte-1mr7uv1">Hard</button> <button class="good svelte-1mr7uv1">Good</button> <button class="easy svelte-1mr7uv1">Easy</button></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
