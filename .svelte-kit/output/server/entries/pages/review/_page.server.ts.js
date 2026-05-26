import { redirect } from "@sveltejs/kit";
import { g as getDueCard } from "../../../chunks/srs.js";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { chessgroundDests } from "chessops/compat";
const load = async () => {
  const card = getDueCard();
  if (!card) throw redirect(302, "/");
  const setup = parseFen(card.fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  const destsMap = chessgroundDests(pos);
  const dests = Object.fromEntries(destsMap);
  const turnColor = pos.turn === "white" ? "white" : "black";
  return { card, dests, turnColor };
};
export {
  load
};
