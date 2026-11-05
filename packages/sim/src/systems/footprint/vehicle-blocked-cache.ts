import type { ContentSet } from '@open-northland/data';
import { Position, Vehicle } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { forEachVehicleFootprintNode } from './vehicle-footprint.js';

// The memoized per-world cache of cells standing vehicles cover, which other vehicles may not enter,
// counted per cell so a vehicle's own disc never hides another's cover of the same cell.
// Keyed on the Vehicle store's membership and value generations: a vehicle stands still until a mover
// writes it, and that write goes through `World.mut(e, Vehicle)`, which is what keeps the key exact once
// vehicles move.

interface VehicleBlockedCache {
  membershipGeneration: number;
  valueGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Map<NodeId, number>;
}

const vehicleBlockedCache = new WeakMap<World, VehicleBlockedCache>();

/** Every standing vehicle's disc, as how many discs cover each cell. Settlers walk through it, as the
 *  original's map attach sets no blocked bit; only vehicles collide. */
function deriveVehicleBlockedCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): Map<NodeId, number> {
  const cover = new Map<NodeId, number>();
  // Visited node by node: a moving vehicle rewrites its state every tick, so this runs that often.
  const count = (hx: number, hy: number): void => {
    const node = terrain.nodeAt(hx, hy);
    cover.set(node, (cover.get(node) ?? 0) + 1);
  };
  for (const e of world.query(Vehicle, Position))
    forEachVehicleFootprintNode(world, content, terrain, e, count);
  return cover;
}

function sameCover(a: ReadonlyMap<NodeId, number>, b: ReadonlyMap<NodeId, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [cell, count] of a) if (b.get(cell) !== count) return false;
  return true;
}

function verifyVehicleBlockedCache(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const cached = vehicleBlockedCache.get(world);
  if (cached === undefined || cached.terrain !== terrain || cached.content !== content) return [];
  if (
    cached.membershipGeneration !== world.componentGeneration(Vehicle) ||
    cached.valueGeneration !== world.componentValueGeneration(Vehicle)
  ) {
    return [];
  }
  const fresh = deriveVehicleBlockedCells(world, content, terrain);
  if (!sameCover(cached.cells, fresh)) {
    return ['vehicleBlockedCells cache disagrees with a fresh derive - a Vehicle moved outside World.mut'];
  }
  return [];
}

/** The cells standing vehicles cover right now, each with how many vehicles cover it. Derived state,
 *  never hashed; the returned map is the shared cached copy, reads only. */
export function vehicleBlockedCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
): ReadonlyMap<NodeId, number> {
  const membershipGeneration = world.componentGeneration(Vehicle);
  const valueGeneration = world.componentValueGeneration(Vehicle);
  const cached = vehicleBlockedCache.get(world);
  if (
    cached !== undefined &&
    cached.terrain === terrain &&
    cached.content === ctx.content &&
    cached.membershipGeneration === membershipGeneration &&
    cached.valueGeneration === valueGeneration
  ) {
    return cached.cells;
  }
  const cells = deriveVehicleBlockedCells(world, ctx.content, terrain);
  vehicleBlockedCache.set(world, {
    membershipGeneration,
    valueGeneration,
    content: ctx.content,
    terrain,
    cells,
  });
  world.registerCacheVerifier('vehicleBlockedCells', () =>
    verifyVehicleBlockedCache(world, ctx.content, terrain),
  );
  return cells;
}
