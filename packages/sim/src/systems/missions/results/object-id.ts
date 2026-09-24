import { isValidPlayer, ownerOf, Person, restampMissionId } from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
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
