import { N as bind_props, a8 as run, $ as head, X as escape_html, G as attr, J as attr_class, Q as derived } from "../../../chunks/renderer.js";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { chessgroundDests } from "chessops/compat";
import "chessground";
import { l as loadSettings } from "../../../chunks/settings.js";
import { a as applyReview } from "../../../chunks/srs.js";
import "../../../chunks/db.js";
const BASE = "https://lichess.org";
async function cloudEval(fen, multiPv = 3) {
  const params = new URLSearchParams({ fen, multiPv: String(multiPv) });
  const res = await fetch(`${BASE}/api/cloud-eval?${params}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cloud eval: ${res.status}`);
  return res.json();
}
function ChessBoard($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      fen,
      orientation = "white",
      turnColor = "white",
      lastMove,
      dests,
      interactive = true,
      onMove,
      version = 0
    } = $$props;
    let el;
    function lock() {
    }
    function shake() {
      setTimeout(() => el?.classList.remove("wrong"), 600);
    }
    function highlightSquare(square) {
    }
    function setShapes(shapes) {
    }
    function clearShapes() {
    }
    $$renderer2.push(`<div class="cg-wrap svelte-sb3f9s"></div>`);
    bind_props($$props, { lock, shake, highlightSquare, setShapes, clearShapes });
  });
}
const GOOD_ENOUGH_CP = 50;
async function evaluateMove(fen, move) {
  const origEval = await cloudEval(fen, 1);
  if (!origEval) {
    return { accepted: false, reason: "Position not in cloud eval database — exact move required." };
  }
  const bestCp = origEval.pvs[0]?.cp;
  if (bestCp === void 0) {
    const bestMove = origEval.pvs[0]?.moves?.split(" ")[0];
    return { accepted: move === bestMove, reason: "Forced mate position." };
  }
  let userFen;
  try {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const uciMove = parseUci(move);
    if (!uciMove) throw new Error("bad uci");
    pos.play(uciMove);
    userFen = makeFen(pos.toSetup());
  } catch {
    return { accepted: false, reason: "Invalid move for position." };
  }
  const userEval = await cloudEval(userFen, 1);
  if (!userEval) {
    return { accepted: false, reason: "Resulting position not in cloud eval — exact move required." };
  }
  const userCpAfter = userEval.pvs[0]?.cp;
  if (userCpAfter === void 0) {
    return { accepted: false, reason: "That walks into a forced mate." };
  }
  const userMoveCp = -userCpAfter;
  const cpLoss = bestCp - userMoveCp;
  const accepted = cpLoss <= GOOD_ENOUGH_CP;
  return {
    accepted,
    centipawn_loss: cpLoss > 0 ? cpLoss : 0,
    reason: accepted ? void 0 : `Loses ${cpLoss}cp vs best move (limit: ${GOOD_ENOUGH_CP}cp).`
  };
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
    let startedAt = Date.now();
    let hadWrongAttempt = false;
    let pendingRating = null;
    let countdown = null;
    let orientation = initialTurnColor;
    let boardVersion = 0;
    const settings = loadSettings();
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
        complete("Solved!");
        return;
      }
      const computerUci = solution[solutionIndex];
      await delay(350);
      const afterComputerFen = applyUci(nextFen, computerUci);
      if (!afterComputerFen) {
        complete("Solved!");
        return;
      }
      solutionIndex++;
      updatePosition(afterComputerFen, computerUci);
      if (solutionIndex >= solution.length) {
        complete("Solved!");
      } else {
        message = "Keep going.";
      }
    }
    async function handleGameMove(uci) {
      if (uci === card.best_move) {
        updatePosition(applyUci(currentFen, uci) ?? currentFen, uci);
        showBlunderArrow();
        complete("Best move!");
        return;
      }
      if (uci === card.played_move) {
        wrongMove(`That's the original ${card.judgment?.toLowerCase() ?? "mistake"}.`);
        return;
      }
      phase = "evaluating";
      message = "Checking…";
      try {
        const verdict = await evaluateMove(currentFen, uci);
        if (verdict.accepted) {
          const suffix = verdict.centipawn_loss ? ` (−${verdict.centipawn_loss}cp)` : "";
          updatePosition(applyUci(currentFen, uci) ?? currentFen, uci);
          showBlunderArrow();
          complete(`Good enough!${suffix}`);
        } else {
          phase = "playing";
          wrongMove(verdict.reason ?? "Not accurate enough. Try again.");
        }
      } catch {
        phase = "playing";
        if (uci !== card.best_move) {
          wrongMove("Exact best move required (cloud eval offline).");
        }
      }
    }
    function wrongMove(msg) {
      hadWrongAttempt = true;
      message = msg;
      boardVersion++;
      phase = "playing";
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
    function showBlunderArrow() {
      const pm = card.played_move;
      if (!pm || pm.length < 4) return;
    }
    function complete(msg, forcedRating) {
      phase = "complete";
      message = msg;
      pendingRating = computeRating();
      if (settings.autoNext) startCountdown(settings.autoNextSeconds);
    }
    function computeRating() {
      if (hadWrongAttempt) return 2;
      if (Date.now() - startedAt < settings.easyThresholdMinutes * 60 * 1e3) return 4;
      return 3;
    }
    async function startCountdown(totalSecs) {
      let secs = totalSecs;
      countdown = secs;
      while (secs > 0) {
        await delay(1e3);
        secs--;
        countdown = secs > 0 ? secs : null;
      }
      await next();
    }
    async function next() {
      if (pendingRating === null || card.id === void 0) return;
      countdown = null;
      await applyReview(card.id, pendingRating, null, true, null, Date.now() - startedAt);
      window.location.reload();
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
    const RATING_LABELS = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
    const ratingLabel = derived(() => pendingRating !== null ? RATING_LABELS[pendingRating] : "");
    const sourceLabel = derived(computeSourceLabel);
    function computeSourceLabel() {
      const revealed = settings.showCardType || phase === "complete";
      if (card.source === "puzzle") {
        const prefix = revealed ? "Puzzle " : "";
        const showRating = settings.puzzleRating === "always" || settings.puzzleRating === "after" && phase === "complete";
        const rating = showRating && card.puzzle_rating ? ` · Rating ${card.puzzle_rating}` : "";
        return `${prefix}${card.lichess_puzzle_id}${rating}`;
      }
      if (!revealed) return card.lichess_game_id ?? "";
      return `Game ${card.lichess_game_id} · move ${(card.game_move_number ?? 0) + 1} · ${card.judgment}`;
    }
    function lichessUrl() {
      if (card.source === "puzzle") {
        return `https://lichess.org/training/${card.lichess_puzzle_id}`;
      }
      return `https://lichess.org/${card.lichess_game_id}#${card.game_move_number ?? 0}`;
    }
    head("1mr7uv1", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>Review · RookRipper</title>`);
      });
    });
    $$renderer2.push(`<div class="review svelte-1mr7uv1">`);
    ChessBoard($$renderer2, {
      fen: currentFen,
      orientation,
      turnColor,
      lastMove: currentLastMove,
      dests,
      interactive: phase === "playing",
      onMove,
      version: boardVersion
    });
    $$renderer2.push(`<!----> <div class="side svelte-1mr7uv1"><div class="info svelte-1mr7uv1"><div class="source svelte-1mr7uv1">${escape_html(sourceLabel())} <a${attr("href", lichessUrl())} target="_blank" rel="noopener noreferrer" class="lichess-link svelte-1mr7uv1">Open on Lichess ↗</a></div> <div${attr_class("message svelte-1mr7uv1", void 0, { "correct": phase === "complete" })}>${escape_html(message)}</div></div> `);
    if (phase === "playing") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="action-buttons svelte-1mr7uv1"><button class="hint-btn svelte-1mr7uv1">Hint</button> <button class="giveup-btn svelte-1mr7uv1">Give Up</button></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (phase === "complete") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="action-buttons svelte-1mr7uv1"><span class="rating-label svelte-1mr7uv1"${attr("data-rating", ratingLabel())}>${escape_html(ratingLabel())}</span> <button class="next-btn svelte-1mr7uv1">${escape_html(countdown !== null ? `Next in ${countdown}s` : "Next →")}</button></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div></div>`);
  });
}
export {
  _page as default
};
