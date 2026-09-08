import { isValidPlayer, MissionObjectId, ownerOf, Person } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { canonicalById } from '../../spatial/nodes.js';
import type { MissionPass } from '../pass.js';
import { withinRange } from '../targets.js';

/** Give every human of `player` the object id, so a later line can address a whole nation at once. */
export function stampPlayerHumans(pass: MissionPass, player: number, id: number): void {
  stampHumans(pass, player, id, () => true);
}

/** Give the player's humans standing within `range` of the point the object id. */
export function stampHumansInRange(
  pass: MissionPass,
  player: number,
  id: number,
  point: HalfCellNode,
  range: number,
): void {
  stampHumans(pass, player, id, (e) => withinRange(pass.world, e, point, range));
}

function stampHumans(pass: MissionPass, player: number, id: number, keep: (e: Entity) => boolean): void {
  const { world } = pass;
  if (!isValidPlayer(player)) return;
  for (const e of canonicalById(world.query(Person))) {
    if (ownerOf(world, e) === player && keep(e)) restampMissionId(world, e, id);
  }
}

/** Renumber an entity the script already addressed. Unlike the placement stamp this also clears the
 *  id, since 0 is the script's own "no id" and a renumbering may drop an entity out of a group. */
function restampMissionId(world: World, e: Entity, id: number): void {
  if (id === 0) world.remove(e, MissionObjectId);
  else world.add(e, MissionObjectId, { id });
}
