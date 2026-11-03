import type { Recipe } from '@open-northland/data';
import { Stockpile } from '../../../../../components/index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../../../../context.js';
import { shelfBlockedOutputs } from '../../../../economy/production.js';
import { dynamicBlockOverlay } from '../../../../footprint/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../../spatial/metric.js';
import { stockpilesAtNode } from '../../../../spatial/stockpiles.js';
import {
  isLoosePile,
  lowestStockedGood,
  MAX_GROUND_STACK,
  mergedRecipeOf,
} from '../../../../stores/index.js';
import { pullsHaulingCart } from '../../../../vehicles/hauling-cart.js';
import { atOrWalk, startDrop } from '../../../atomics/start.js';
import type { PlannerContext } from '../../../planner/context.js';
import { interactionCell } from '../../../targets/index.js';
import { carriedGoodForm } from '../delivery-targets.js';

// Owner ruling: a worker whose full output shelf no store can clear sets the goods down at the workshop's
// door instead of standing idle, where the original stops at the full shelf. Carriers, consumers and the
// seat's stock read the heap as any other.

/** The units of one good a door's heap holds before its worker stops (authored): two tiles' stacks, so a
 *  workshop does not turn all its inputs into a heap. */
export const DOOR_HEAP_LIMIT_UNITS = 2 * MAX_GROUND_STACK;

/** How far from the door the heap counts and may spread, in rings of nodes. Cramped ground with no tile
 *  free this near stops the worker, so the heap never scatters out of the count. */
export const DOOR_HEAP_RADIUS_NODES = 3;

/** The units of `good` the heap around `door` still takes: none at its limit or with no tile free. A trader
 *  unloading at its own full stop heaps by the same bound. */
export function doorHeapRoom(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  door: NodeId,
  good: number,
): number {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const { x, y } = terrain.coordsOf(door);
  let heaped = 0;
  let tileFree = false;
  for (let ring = 0; ring <= DOOR_HEAP_RADIUS_NODES; ring++) {
    const offsets = ringOffsetCount(ring);
    for (let i = 0; i < offsets; i++) {
      const node = terrain.nodeAtClamped(x + ringOffsetDx(ring, i), y + ringOffsetDy(ring, i));
      if (!terrain.isWalkable(node) || blocked.has(node)) continue;
      const { x: hx, y: hy } = terrain.coordsOf(node);
      let fill = 0;
      let foreign = false;
      for (const e of stockpilesAtNode(world, hx, hy)) {
        if (!isLoosePile(world, e)) continue;
        const stock = world.get(e, Stockpile);
        const held = lowestStockedGood(stock);
        if (held !== null && held !== good) foreign = true;
        fill += stock.amounts.get(good) ?? 0;
      }
      heaped += fill;
      tileFree ||= !foreign && fill < MAX_GROUND_STACK;
    }
  }
  return tileFree ? Math.max(0, DOOR_HEAP_LIMIT_UNITS - heaped) : 0;
}

/** An output stopping `recipes` at `workplace` that `worker` may lift for the door, and how much of it. */
export interface DoorHeapLift {
  readonly goodType: number;
  readonly units: number;
}

/** The first output on a full shelf stopping `recipes` that no store takes (`deliverable`) and the door's
 *  heap has room for, or null. */
export function doorHeapLift(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  worker: Entity,
  workplace: Entity,
  recipes: Iterable<Recipe>,
  deliverable: (goodType: number) => boolean,
): DoorHeapLift | null {
  const door = interactionCell(world, ctx, terrain, workplace);
  for (const goodType of shelfBlockedOutputs(world, ctx, workplace, recipes)) {
    if (deliverable(goodType)) continue;
    const units = doorHeapRoom(world, ctx, terrain, door, carriedGoodForm(world, ctx, worker, goodType));
    if (units > 0) return { goodType, units };
  }
  return null;
}

/** Set a lifted output of `workplace` down at its door; false for any other load, which the delivery
 *  rung keeps. A unit lifted before the heap filled goes down all the same. */
export function setDownAtDoor(plan: PlannerContext, workplace: Entity, goodType: number): boolean {
  const { world, ctx, terrain, entity, here } = plan;
  const outputs = mergedRecipeOf(world, ctx, workplace)?.outputs;
  if (outputs === undefined || pullsHaulingCart(world, entity)) return false;
  if (!outputs.some((output) => carriedGoodForm(world, ctx, entity, output.goodType) === goodType))
    return false;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, workplace, here), () =>
    startDrop(world, ctx, entity),
  );
  return true;
}
