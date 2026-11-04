import { Livestock, ownerOf, Position, Settler } from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import {
  groundDistance,
  HUNT_CHASE_SLACK_NODES,
  workplaceHuntingGround,
} from '../../conflict/hunting/index.js';
import { hunterJobType } from '../../readviews/index.js';
import { entityNode } from '../../spatial/nodes.js';
import { huntWorkLeft } from '../workforce/hunter.js';
import type { ColonyEnv } from './voyage.js';

/** Whether a wild animal of a livestock species stands within the chase of the hunters `store` employs, on
 *  the colony's land: a hunter shoots any ownerless one he may hunt. Livestock is a small store. */
function herdInReach(env: ColonyEnv, store: Entity): boolean {
  const { world, terrain } = env;
  const ground = workplaceHuntingGround(world, terrain, store);
  if (ground === null) return false;
  const reach = ground.radius + HUNT_CHASE_SLACK_NODES;
  for (const animal of world.query(Livestock, Position)) {
    if (ownerOf(world, animal) !== undefined) continue;
    const at = entityNode(world, terrain, animal);
    if (
      terrain.componentOf(at) === env.colony.land &&
      groundDistance(terrain, ground.anchorCell, at) <= reach
    )
      return true;
  }
  return false;
}

/**
 * Whether the colony posts hunters among `men` at its store: game is left on their ground, past it by the
 * chase's leash while one hunts (owner ruling: hunters kill the game quickly and then stand idle), and,
 * while the colony has `otherFood` (fish or a kitchen), no wild cattle stands within that chase (owner
 * ruling: a cow or sheep is worth far more caught by the scout, and a hunter feeds little beside fishers and
 * a bakery). A colony with no other food still hunts what it finds. Our own choice for the computer player;
 * the hunter's rule of what he may shoot stays every player's.
 */
export function huntingOpen(
  env: ColonyEnv,
  store: Entity | null,
  men: readonly Entity[],
  otherFood: boolean,
): boolean {
  const { world, ctx } = env;
  const job = hunterJobType(ctx.content);
  if (store === null || job === null || !isBuilt(world, store)) return false;
  if (otherFood && herdInReach(env, store)) return false;
  const hunters = men.filter((e) => world.get(e, Settler).jobType === job);
  return huntWorkLeft(world, ctx, store, job, hunters, hunters.length > 0 ? HUNT_CHASE_SLACK_NODES : 0);
}
