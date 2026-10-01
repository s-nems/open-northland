import { ownerOf, ownersCompatible, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { interactionCell } from '../settlers/targets/workplaces.js';
import { navigationLimitFor } from '../signposts/index.js';

/** Stores or sources of the worker's side one diagnosis weighs before it stops calling the case decided. */
const MAX_DIAGNOSTIC_STORES = 128;

/**
 * Where a worker's side has stores for an errand: at least one inside the worker's signpost area
 * (`inReach`), only outside it (`outOfReach`), or none at all (`none`). A worker nothing confines, or a
 * band too large to decide, counts as `inReach`, so the diagnosis never claims a blocker it cannot prove.
 */
export type StoreReach = 'inReach' | 'outOfReach' | 'none';

/** Where `worker`'s side has `stores`, against its signpost area, as its confined search sees them. */
export function storeReach(
  world: World,
  ctx: SystemContext,
  worker: Entity,
  stores: Iterable<Entity>,
): StoreReach {
  return reachAmong(world, worker, stores, signpostGate(world, ctx, worker));
}

/** Whether `worker`'s side has `stores` but all of them outside its signpost area; an unconfined worker
 *  answers false without weighing any store. */
export function storesOnlyOutOfReach(
  world: World,
  ctx: SystemContext,
  worker: Entity,
  stores: Iterable<Entity>,
): boolean {
  const gate = signpostGate(world, ctx, worker);
  return gate !== null && reachAmong(world, worker, stores, gate) === 'outOfReach';
}

function reachAmong(
  world: World,
  worker: Entity,
  stores: Iterable<Entity>,
  reaches: ((store: Entity) => boolean) | null,
): StoreReach {
  const owner = ownerOf(world, worker);
  let examined = 0;
  let ownSide = false;
  for (const store of stores) {
    // Another side's stores never count, so they cannot use up the cap before the worker's own are seen.
    if (!ownersCompatible(owner, ownerOf(world, store))) continue;
    if (examined++ >= MAX_DIAGNOSTIC_STORES) return 'inReach';
    if (reaches === null || reaches(store)) return 'inReach';
    ownSide = true;
  }
  return ownSide ? 'outOfReach' : 'none';
}

/** Whether a store's door lies inside `worker`'s signpost area; null when nothing confines the worker. */
function signpostGate(world: World, ctx: SystemContext, worker: Entity): ((store: Entity) => boolean) | null {
  const terrain = ctx.terrain;
  const position = world.tryGet(worker, Position);
  if (terrain === undefined || position === undefined) return null;
  const limit = navigationLimitFor(world, ctx.content, terrain, worker);
  if (limit === null) return null;
  const node = nodeOfPosition(position.x, position.y);
  const here = terrain.nodeAtClamped(node.hx, node.hy);
  return (store) => limit.allowsNode(interactionCell(world, ctx, terrain, store, here));
}
