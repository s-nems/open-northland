import type { ContentSet } from '@open-northland/data';
import { Position, Vehicle } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { sameCells } from './geometry.js';
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
}

const vehicleBlockedCache = new WeakMap<World, VehicleBlockedCache>();

/** Every standing vehicle's disc, so a settler walks around a parked cart and its crew stands beside it
 *  (approximation: the original's map attach links the node's moveable list and sets no blocked bit).
 *  The door lies outside the disc unless nothing around the vehicle is open ground, and then it stays
 *  passable like a building's door. */
function deriveVehicleBlockedCells(world: World, content: ContentSet, terrain: TerrainGraph): Set<NodeId> {
  const blocked = new Set<NodeId>();
  const doors = new Set<NodeId>();
  for (const e of world.query(Vehicle, Position)) {
    for (const node of vehicleFootprintNodes(world, content, terrain, e)) blocked.add(node);
    const door = vehicleDoorNode(world, { content, terrain }, e);
    if (door !== null && terrain.inBounds(door.hx, door.hy)) doors.add(terrain.nodeAt(door.hx, door.hy));
  }
  for (const door of doors) blocked.delete(door);
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
  if (sameCells(cached.cells, fresh)) return [];
  return [
    `vehicleBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} - a Vehicle moved outside World.mut`,
  ];
}

/** The cells standing vehicles make unwalkable right now. Derived state, never hashed; the returned
 *  set is the shared cached copy, membership reads only. */
export function vehicleBlockedCells(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
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
