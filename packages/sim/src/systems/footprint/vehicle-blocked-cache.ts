import type { ContentSet } from '@open-northland/data';
import { Position, Vehicle } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { CountedCells } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { countsMatchCells, sameCells } from './geometry.js';
import { vehicleDoorNode, vehicleFootprintNodes } from './vehicle-footprint.js';

// The memoized per-world cache of cells standing vehicles make unwalkable - the vehicle twin of
// ./building-blocked-cache.ts. Keyed on the Vehicle store's membership and value generations: a vehicle
// stands still until a mover writes it, and that write goes through `World.mut(e, Vehicle)`, which is
// what keeps the key exact once vehicles move.

interface VehicleBlockedCache {
  membershipGeneration: number;
  valueGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
  readonly counts: Uint16Array;
}

const vehicleBlockedCache = new WeakMap<World, VehicleBlockedCache>();

/** Every standing vehicle's disc, so a settler walks around a parked cart and its crew stands beside it
 *  (approximation: the original's map attach links the node's moveable list and sets no blocked bit).
 *  A door lies outside its own disc unless nothing around the vehicle is open ground, and then it stays
 *  passable like a building's door; a door another vehicle covers is that vehicle's cell, and the
 *  boarding node's ring snap moves the crew beside it. */
function deriveVehicleBlockedCells(world: World, content: ContentSet, terrain: TerrainGraph): Set<NodeId> {
  const blocked = new Set<NodeId>();
  for (const e of world.query(Vehicle, Position)) {
    const door = vehicleDoorNode(world, { content, terrain }, e);
    const doorNode =
      door !== null && terrain.inBounds(door.hx, door.hy) ? terrain.nodeAt(door.hx, door.hy) : null;
    for (const node of vehicleFootprintNodes(world, content, terrain, e)) {
      if (node !== doorNode) blocked.add(node);
    }
  }
  return blocked;
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
  if (!sameCells(cached.cells, fresh)) {
    return [
      `vehicleBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} - a Vehicle moved outside World.mut`,
    ];
  }
  if (!countsMatchCells(cached.counts, cached.cells)) {
    return ['vehicleBlockedCells counts disagree with its cells - a rebuild missed a restamp'];
  }
  return [];
}

/** The cells standing vehicles make unwalkable right now. Derived state, never hashed; the returned
 *  set is the shared cached copy, membership reads only. */
export function vehicleBlockedCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  return vehicleBlockedLayer(world, ctx, terrain).cells;
}

/** {@link vehicleBlockedCells} with its per-node counts, for the dynamic overlay. */
export function vehicleBlockedLayer(world: World, ctx: ContentContext, terrain: TerrainGraph): CountedCells {
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
    return cached;
  }
  const cells = deriveVehicleBlockedCells(world, ctx.content, terrain);
  let counts: Uint16Array;
  if (cached?.terrain === terrain) {
    counts = cached.counts;
    for (const cell of cached.cells) counts[cell] = 0;
  } else {
    counts = new Uint16Array(terrain.nodeCount);
  }
  for (const cell of cells) counts[cell] = 1;
  const cache: VehicleBlockedCache = {
    membershipGeneration,
    valueGeneration,
    content: ctx.content,
    terrain,
    cells,
    counts,
  };
  vehicleBlockedCache.set(world, cache);
  world.registerCacheVerifier('vehicleBlockedCells', () =>
    verifyVehicleBlockedCache(world, ctx.content, terrain),
  );
  return cache;
}
