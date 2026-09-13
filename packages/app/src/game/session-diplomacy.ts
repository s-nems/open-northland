import type { MapDiplomacy } from '@open-northland/data';
import type { GameSession } from '@open-northland/lockstep';

export function sessionDiplomacy(
  session: Pick<GameSession, 'seats'>,
  authored: readonly MapDiplomacy[],
): readonly MapDiplomacy[] {
  const rows = [...authored];
  for (const from of session.seats) {
    if (from.team == null) continue;
    for (const to of session.seats) {
      if (to.player === from.player || to.team == null) continue;
      rows.push({ from: from.player, to: to.player, state: from.team === to.team ? 'friend' : 'enemy' });
    }
  }
  return rows;
}
