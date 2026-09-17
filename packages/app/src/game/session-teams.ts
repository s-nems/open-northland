import type { MapDiplomacy } from '@open-northland/data';
import type { GameSession } from '@open-northland/lockstep';

type Seats = Pick<GameSession, 'seats'>;

/** The authored stances plus the lobby's: seats on one team are mutual friends, seats on different
 *  teams mutual enemies, and a seat without a team keeps the map's rows. */
export function sessionDiplomacy(session: Seats, authored: readonly MapDiplomacy[]): readonly MapDiplomacy[] {
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

/** The seats of each lobby team with two or more members, ascending by player: the players that
 *  explore, see and meet through one fog mask (`setSharedVision`). */
export function sessionSharedVision(session: Seats): readonly (readonly number[])[] {
  const teams = new Map<number, number[]>();
  for (const seat of session.seats) {
    if (seat.team == null) continue;
    const members = teams.get(seat.team);
    if (members === undefined) teams.set(seat.team, [seat.player]);
    else members.push(seat.player);
  }
  return [...teams.values()]
    .filter((members) => members.length > 1)
    .map((members) => members.sort((a, b) => a - b))
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
}
