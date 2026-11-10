import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { ClearanceField } from '../../nav/clearance.js';
import { findPath } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { vehicleClearance } from '../footprint/vehicle-clearance.js';

// The routes ships found past other vehicles, held while the water stands as it did. Such a search reads
// the static water edges and which water nodes the hull's free-size class closes, nothing else: a ground
// blocker on water leaves its node no class, and a hull clear of other vehicles' discs adds no node of
// its own. So a trader sailing the same two berths, or an order given after its course was judged, reads
// the route instead of searching a sea again. Derived state, never hashed.

/** The routes one hull size holds for one state of its water. */
interface HeldRoutes {
  readonly field: ClearanceField;
  readonly terrain: TerrainGraph;
  readonly waterRevision: number;
  /** By {@link routeKey}, the least recently read first. */
  readonly routes: Map<number, readonly NodeId[] | null>;
}

/** The routes a hull size keeps, the least recently read dropped first. Authored: a few fleets' berths
 *  and shores, each route a few hundred nodes. */
const SEA_ROUTE_MEMO_ENTRIES = 128;

const heldByWorld = new WeakMap<World, Map<number, HeldRoutes>>();

function routeKey(terrain: TerrainGraph, start: NodeId, goal: NodeId): number {
  return start * terrain.nodeCount + goal;
}

/**
 * `findPath` over water from `start` to `goal` under `pastVehicles`, the ground walk-block and the size
 * test of a hull of `logicSize` with no other vehicle's cells, for a hull of at least size 1 that stands
 * in no other vehicle's disc. The returned route is the held copy: reads only.
 */
export function seaRoutePastVehicles(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  logicSize: number,
  start: NodeId,
  goal: NodeId,
  pastVehicles: BlockOverlay,
): readonly NodeId[] | null {
  const field = vehicleClearance(world, ctx, terrain);
  let bySize = heldByWorld.get(world);
  if (bySize === undefined) {
    const created = new Map<number, HeldRoutes>();
    heldByWorld.set(world, created);
    world.registerCacheVerifier('seaRoutes', () => verifyRoutes(world, ctx, created));
    bySize = created;
  }
  const waterRevision = field.waterRevision(logicSize);
  let held = bySize.get(logicSize);
  if (
    held === undefined ||
    held.field !== field ||
    held.terrain !== terrain ||
    held.waterRevision !== waterRevision
  ) {
    held = { field, terrain, waterRevision, routes: new Map() };
    bySize.set(logicSize, held);
  }
  const key = routeKey(terrain, start, goal);
  const known = held.routes.get(key);
  if (known !== undefined) {
    held.routes.delete(key);
    held.routes.set(key, known);
    return known;
  }
  const route = findPath(terrain, start, goal, pastVehicles, undefined, 'water');
  held.routes.set(key, route);
  if (held.routes.size > SEA_ROUTE_MEMO_ENTRIES) {
    for (const oldest of held.routes.keys()) {
      held.routes.delete(oldest);
      break;
    }
  }
  return route;
}

/** The coherence tripwire: a route held for the water's current classes must be the one a fresh search
 *  finds under the size test and the ground walk-block alone. */
function verifyRoutes(world: World, ctx: ContentContext, bySize: ReadonlyMap<number, HeldRoutes>): string[] {
  const errors: string[] = [];
  for (const [logicSize, held] of bySize) {
    const field = vehicleClearance(world, ctx, held.terrain);
    if (field !== held.field || field.waterRevision(logicSize) !== held.waterRevision) continue;
    const terrain = held.terrain;
    const below = field.belowLane(logicSize);
    const ground = dynamicBlockOverlay(world, ctx, terrain);
    const blocked: BlockOverlay = { has: (node) => below[node] === 1 || ground.has(node), size: 1 };
    for (const [key, route] of held.routes) {
      const start = Math.floor(key / terrain.nodeCount) as NodeId;
      const goal = (key % terrain.nodeCount) as NodeId;
      const fresh = findPath(terrain, start, goal, blocked, undefined, 'water');
      const same =
        fresh === null || route === null
          ? fresh === route
          : fresh.length === route.length && fresh.every((node, i) => node === route[i]);
      if (!same) {
        errors.push(
          `the held sea route ${start} -> ${goal} for hull size ${logicSize} is not the one a fresh search finds - a water change missed the revision`,
        );
      }
    }
  }
  return errors;
}
