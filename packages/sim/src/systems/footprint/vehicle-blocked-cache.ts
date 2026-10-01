import type { ContentSet } from '@open-northland/data';
import { Position, Vehicle } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { sameCells } from './geometry.js';
import { vehicleFootprintNodes } from './vehicle-footprint.js';

// The memoized per-world cache of cells standing vehicles cover, which other vehicles may not enter.
// Keyed on the Vehicle store's membership and value generations: a vehicle stands still until a mover
// writes it, and that write goes through `World.mut(e, Vehicle)`, which is what keeps the key exact once
// vehicles move.

interface VehicleBlockedCache {
  membershipGeneration: number;
  valueGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
}

const vehicleBlockedCache = new WeakMap<World, VehicleBlockedCache>();

/** Every standing vehicle's disc. Settlers walk through it, as the original's map attach sets no
 *  blocked bit; only vehicles collide. */
function deriveVehicleBlockedCells(world: World, content: ContentSet, terrain: TerrainGraph): Set<NodeId> {
  const blocked = new Set<NodeId>();
  for (const e of world.query(Vehicle, Position)) {
    for (const node of vehicleFootprintNodes(world, content, terrain, e)) blocked.add(node);
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
  return [];
}

/** The cells standing vehicles cover right now. Derived state, never hashed; the returned set is the
 *  shared cached copy, membership reads only. */
export function vehicleBlockedCells(
  world: World,
  ctx: ContentContext,
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
