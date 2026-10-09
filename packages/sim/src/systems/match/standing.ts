import { diplomacyStance } from '../../components/index.js';
import type { World } from '../../ecs/world.js';

export function allMutualFriends(world: World, players: readonly number[]): boolean {
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (b === undefined) continue;
      if (diplomacyStance(world, a, b) !== 'friend' || diplomacyStance(world, b, a) !== 'friend') {
        return false;
      }
    }
  }
  return true;
}

/** At least two bits set: a match with one seat has nobody to beat. */
export function hasTwoSeats(bits: number): boolean {
  return (bits & (bits - 1)) !== 0;
}
