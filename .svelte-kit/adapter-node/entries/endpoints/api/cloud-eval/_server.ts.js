import { error, json } from "@sveltejs/kit";
import { c as cloudEval } from "../../../../chunks/lichess.js";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
const GOOD_ENOUGH_CP = 50;
const POST = async ({ request }) => {
  const { fen, move } = await request.json();
  if (!fen || !move) throw error(400, "fen and move required");
  const origEval = await cloudEval(fen, 1);
  if (!origEval) {
    return json({
      accepted: false,
      reason: "Position not in cloud eval database — exact move required."
    });
  }
  const bestCp = origEval.pvs[0]?.cp;
  if (bestCp === void 0) {
    const bestMove = origEval.pvs[0]?.moves?.split(" ")[0];
    return json({ accepted: move === bestMove, reason: "Forced mate position." });
  }
  let userFen;
  try {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const uciMove = parseUci(move);
    if (!uciMove) throw new Error("bad uci");
    pos.play(uciMove);
    userFen = makeFen(pos.toSetup());
  } catch {
    throw error(400, "Invalid move for position");
  }
  const userEval = await cloudEval(userFen, 1);
  if (!userEval) {
    return json({
      accepted: false,
      reason: "Resulting position not in cloud eval — exact move required."
    });
  }
  const userCpAfter = userEval.pvs[0]?.cp;
  if (userCpAfter === void 0) {
    return json({ accepted: false, reason: "That walks into a forced mate." });
  }
  const userMoveCp = -userCpAfter;
  const cpLoss = bestCp - userMoveCp;
  const accepted = cpLoss <= GOOD_ENOUGH_CP;
  return json({
    accepted,
    centipawn_loss: cpLoss > 0 ? cpLoss : 0,
    reason: accepted ? void 0 : `Loses ${cpLoss}cp vs best move (limit: ${GOOD_ENOUGH_CP}cp).`
  });
};
export {
  POST
};
