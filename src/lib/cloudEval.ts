import { Chess } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import { cloudEval } from './lichess';

// A game-card move is accepted if it loses no more than this vs. the engine's
// best. Formerly the GOOD_ENOUGH_CP constant in /api/cloud-eval.
const GOOD_ENOUGH_CP = 50;

export interface EvalVerdict {
  accepted: boolean;
  centipawn_loss?: number;
  reason?: string;
}

// Checks a user's move against Lichess cloud eval. Two calls: the original
// position and the position after the move. Runs directly from the browser.
// When a position isn't in the cloud DB (404), we can't judge leniently, so the
// caller falls back to requiring the exact best move.
export async function evaluateMove(fen: string, move: string): Promise<EvalVerdict> {
  const origEval = await cloudEval(fen, 1);
  if (!origEval) {
    return { accepted: false, reason: 'Position not in cloud eval database — exact move required.' };
  }

  const bestCp = origEval.pvs[0]?.cp;
  if (bestCp === undefined) {
    // Forced mate on the board — accept only the mating move.
    const bestMove = origEval.pvs[0]?.moves?.split(' ')[0];
    return { accepted: move === bestMove, reason: 'Forced mate position.' };
  }

  let userFen: string;
  try {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const uciMove = parseUci(move);
    if (!uciMove) throw new Error('bad uci');
    pos.play(uciMove);
    userFen = makeFen(pos.toSetup());
  } catch {
    return { accepted: false, reason: 'Invalid move for position.' };
  }

  const userEval = await cloudEval(userFen, 1);
  if (!userEval) {
    return { accepted: false, reason: 'Resulting position not in cloud eval — exact move required.' };
  }

  const userCpAfter = userEval.pvs[0]?.cp;
  if (userCpAfter === undefined) {
    return { accepted: false, reason: 'That walks into a forced mate.' };
  }

  // userCpAfter is from the opponent's perspective, so negate for our side.
  const userMoveCp = -userCpAfter;
  const cpLoss = bestCp - userMoveCp;
  const accepted = cpLoss <= GOOD_ENOUGH_CP;

  return {
    accepted,
    centipawn_loss: cpLoss > 0 ? cpLoss : 0,
    reason: accepted ? undefined : `Loses ${cpLoss}cp vs best move (limit: ${GOOD_ENOUGH_CP}cp).`
  };
}
