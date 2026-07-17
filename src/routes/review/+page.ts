import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { PageLoad } from './$types';
import { getDueCard } from '$lib/srs';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { chessgroundDests } from 'chessops/compat';

export const load: PageLoad = async ({ url }) => {
  const sp = url.searchParams.get('source');
  const source = sp === 'puzzle' || sp === 'game' ? sp : undefined;
  const card = await getDueCard(source);

  if (!card) throw redirect(302, `${base}/`);

  const setup = parseFen(card.fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  const destsMap = chessgroundDests(pos);

  const dests = Object.fromEntries(destsMap) as Record<string, string[]>;
  const turnColor = pos.turn === 'white' ? 'white' : 'black';

  return { card, dests, turnColor };
};
