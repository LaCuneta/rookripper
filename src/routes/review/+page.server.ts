import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDueCard } from '$lib/server/srs';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { chessgroundDests } from 'chessops/compat';

export const load: PageServerLoad = async ({ url }) => {
  const sp = url.searchParams.get('source');
  const source = sp === 'puzzle' || sp === 'game' ? sp : undefined;
  const card = getDueCard(source);

  if (!card) throw redirect(302, '/');

  const setup = parseFen(card.fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  const destsMap = chessgroundDests(pos);

  // Serialize Map to plain object for SvelteKit data transport
  const dests = Object.fromEntries(destsMap) as Record<string, string[]>;
  const turnColor = pos.turn === 'white' ? 'white' : 'black';

  return { card, dests, turnColor };
};
