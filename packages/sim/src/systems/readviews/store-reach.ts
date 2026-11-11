import { ownerOf, ownersCompatible, Position, sameSideAs } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { QUALIFIES } from '../settlers/targets/cell-index.js';
import { heldBands } from '../settlers/targets/held-bands.js';
import { FetchableStock } from '../settlers/targets/stores/fetchable-stock.js';
import { interactionCell } from '../settlers/targets/workplaces.js';
import { goodsSearchGate, navigationLimitFor } from '../signposts/index.js';

/** Stores or sources of the worker's side one diagnosis weighs before it stops calling the case decided. */
const MAX_DIAGNOSTIC_STORES = 128;

/**
 * Where a worker's side has stores for an errand, against the area its search covers: at least one inside
 * it (`inReach`), only ones outside it (`outOfReach`), none at all (`none`), or more than one diagnosis
 * weighs with none of those inside (`undecided`), so the diagnosis never claims what it cannot prove. A
 * search nothing confines finds every store in reach.
 */
export type StoreReach = 'inReach' | 'outOfReach' | 'none' | 'undecided';

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

/**
 * Where `operator`'s side has `goodType` for `workplace`, as the operator's fetch searches for it: from the
 * workplace's door, through the goods search there within the operator's signpost area, else over the
 * door's land. The stores are searched in the fetch's own index, so they cost one search bounded by that
 * area however many lie beyond it; the side's `producers`, whose next unit lands on a shelf, are weighed
 * one by one. A mapless sim confines nothing.
 */
export function inputReach(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  workplace: Entity,
  goodType: number,
  producers: Iterable<Entity>,
): StoreReach {
  const stock = FetchableStock.of(world, ctx);
  const terrain = ctx.terrain;
  const here = terrain === undefined ? null : nodeOf(world, terrain, operator);
  if (terrain === undefined || here === null) {
    const stored = reachAmong(world, operator, stock.holders(goodType), null);
    return stored === 'none' ? reachAmong(world, operator, producers, null) : stored;
  }
  const owner = ownerOf(world, operator);
  const door = interactionCell(world, ctx, terrain, workplace, here);
  const limit = navigationLimitFor(world, ctx.content, terrain, operator) ?? undefined;
  const gate = goodsSearchGate(world, ctx.content, terrain, owner, door, limit);
  const band = heldBands(world, ctx, terrain).supplying(goodType);
  band.sync();
  const notOwnShelf = (e: Entity) => (e === workplace ? null : QUALIFIES);
  if (band.index.nearest(here, notOwnShelf, gate, undefined, sameSideAs(world, owner), door) !== null) {
    return 'inReach';
  }
  const produced = reachAmong(world, operator, producers, (source) =>
    gate.allowsNode(interactionCell(world, ctx, terrain, source, here)),
  );
  if (produced !== 'none') return produced;
  const stocked =
    owner === undefined
      ? stock.holders(goodType).size + stock.refillers(goodType).size > 0
      : stock.sideSupplies(owner, goodType);
  return stocked ? 'outOfReach' : 'none';
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
    if (examined++ >= MAX_DIAGNOSTIC_STORES) return 'undecided';
    if (reaches === null || reaches(store)) return 'inReach';
    ownSide = true;
  }
  return ownSide ? 'outOfReach' : 'none';
}

/** Whether a store's door lies inside `worker`'s signpost area; null when nothing confines the worker. */
function signpostGate(world: World, ctx: SystemContext, worker: Entity): ((store: Entity) => boolean) | null {
  const terrain = ctx.terrain;
  const here = terrain === undefined ? null : nodeOf(world, terrain, worker);
  if (terrain === undefined || here === null) return null;
  const limit = navigationLimitFor(world, ctx.content, terrain, worker);
  if (limit === null) return null;
  return (store) => limit.allowsNode(interactionCell(world, ctx, terrain, store, here));
}

/** The node `e` stands on, or null for an unplaced one. */
function nodeOf(world: World, terrain: TerrainGraph, e: Entity): NodeId | null {
  const position = world.tryGet(e, Position);
  if (position === undefined) return null;
  const node = nodeOfPosition(position.x, position.y);
  return terrain.nodeAtClamped(node.hx, node.hy);
}
