import { ownerOf, ownersCompatible, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { interactionCell } from '../settlers/targets/workplaces.js';
import { navigationLimitFor } from '../signposts/index.js';

/** Stores one diagnosis weighs before it stops calling the case decided. */
const MAX_DIAGNOSTIC_STORES = 128;

/**
 * Whether `worker`'s side has `stores` but every one lies outside the worker's signpost area: the case its
 * confined search reports as no store at all. False when one is in reach, none is owned by its side,
 * nothing confines the worker, or the band is too large to decide.
 */
export function storesOnlyOutOfReach(
  world: World,
  ctx: SystemContext,
  worker: Entity,
  stores: Iterable<Entity>,
): boolean {
  const terrain = ctx.terrain;
  const position = world.tryGet(worker, Position);
  if (terrain === undefined || position === undefined) return false;
  const limit = navigationLimitFor(world, ctx.content, terrain, worker);
  if (limit === null) return false;
  const node = nodeOfPosition(position.x, position.y);
  const here = terrain.nodeAtClamped(node.hx, node.hy);
  const owner = ownerOf(world, worker);
  let examined = 0;
  for (const store of stores) {
    if (!ownersCompatible(owner, ownerOf(world, store))) continue;
    if (examined++ >= MAX_DIAGNOSTIC_STORES) return false;
    if (limit.allowsNode(interactionCell(world, ctx, terrain, store, here))) return false;
  }
  return examined > 0;
}
