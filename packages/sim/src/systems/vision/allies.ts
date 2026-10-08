import { alliedVisionEnabled, diplomacyStance, MAX_PLAYERS } from '../../components/index.js';
import type { World } from '../../ecs/world.js';

/**
 * The vision groups the allied-vision rule asks for: none while it is off, else players joined only
 * where every pair in a group holds mutual `friend` stances, so no player ever sees through a hostile
 * or neutral player's eyes. Players are placed in ascending id, each into the first group it is allied
 * with throughout. Approximation: a player allied to two groups that are not allied to each other
 * shares with the lower one alone.
 */
export function alliedVisionGroups(world: World): number[][] {
  if (!alliedVisionEnabled(world)) return [];
  const allied = (a: number, b: number): boolean =>
    diplomacyStance(world, a, b) === 'friend' && diplomacyStance(world, b, a) === 'friend';
  const groups: number[][] = [];
  for (let player = 0; player < MAX_PLAYERS; player++) {
    const group = groups.find((members) => members.every((member) => allied(member, player)));
    if (group === undefined) groups.push([player]);
    else group.push(player);
  }
  return groups.filter((members) => members.length > 1);
}
