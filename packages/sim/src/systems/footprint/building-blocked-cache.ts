import { type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Position } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, sameCells, translatedCells } from './geometry.js';

// The memoized per-world cache of cells standing buildings make unwalkable, plus its coherence verifier -
// the building twin of ./resource-blocked-cache.ts.

interface BuildingBlockedCache {
  /** Building MEMBERSHIP generation (add/remove/destroy) the cells were derived at. */
  membershipGeneration: number;
  /** Building VALUE generation: the in-place `buildingType` swap of a home tier upgrade changes the cell
   *  set with no membership bump, so the {@link World.mut} value bump must key this cache too. `built`
   *  progress also moves it without changing any cell, so an actively hammered site costs a rebuild per
   *  advance; the derived cells stay correct either way. */
  valueGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
}

const buildingBlockedCache = new WeakMap<World, BuildingBlockedCache>();

/** One full derivation - the rebuild and the verifier's reference run through this single path. */
function deriveBuildingBlockedCells(world: World, content: ContentSet, terrain: TerrainGraph): Set<NodeId> {
  const blocked = new Set<NodeId>();
  // Doors are subtracted after the union, so a door stays passable even when another building's wall cell
  // covers it - the only overlap possible, via the door-in-reserved margin.
  const doors = new Set<NodeId>();
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    const footprint = buildingFootprintOf(content, b.buildingType);
    if (footprint === undefined || footprint.blocked.length === 0) continue;
    const p = world.get(e, Position);
    const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
    for (const cell of translatedCells(terrain, footprint.blocked, ax, ay)) {
      blocked.add(cell);
    }
    const door = footprint.door;
    if (door !== undefined) {
      const doorX = ax + footprintCellDx(ay, door);
      if (terrain.inBounds(doorX, ay + door.dy)) doors.add(terrain.nodeAt(doorX, ay + door.dy));
    }
  }
  for (const cell of doors) blocked.delete(cell);
  return blocked;
}

function verifyBuildingBlockedCache(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const cached = buildingBlockedCache.get(world);
  if (cached === undefined) return [];
  if (cached.terrain !== terrain || cached.content !== content) return [];
  if (
    cached.membershipGeneration !== world.componentGeneration(Building) ||
    cached.valueGeneration !== world.componentValueGeneration(Building)
  ) {
    return []; // stale key - the next read rebuilds, nothing can consume the old cells
  }
  const fresh = deriveBuildingBlockedCells(world, content, terrain);
  if (sameCells(cached.cells, fresh)) return [];
  return [
    `buildingBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} - a Building changed in place outside World.mut`,
  ];
}

/**
 * The cells standing buildings make UNWALKABLE right now - the union of every placed building's
 * `footprint.blocked` cells at its current level. The walk-block applies from the placement tick, so a grey
 * foundation already occupies its cells, exactly like the original.
 *
 * A building's own DOOR cell is always left walkable, even where the source lists it inside the walk-block:
 * `work_pottery_02`'s `LogicDoorPoint` sits inside its `LogicWalkBlockArea`, because a wall's door IS its
 * passable gate. Without the carve-out the walk-to-door goal is a blocked cell, `findPath` fails, and the
 * settler wedges. The extractor keeps the source cells verbatim; the consumer applies the gate semantics.
 *
 * Derived state, never hashed. Memoized per world on the Building store's membership and value
 * generations, so a burst of callers between two building mutations shares one build. The returned set is
 * the SHARED cached copy: membership reads only. A set union with no pick, so store-iteration order cannot
 * change it.
 */
export function buildingBlockedCells(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  const membershipGeneration = world.componentGeneration(Building);
  const valueGeneration = world.componentValueGeneration(Building);
  const cached = buildingBlockedCache.get(world);
  if (
    cached !== undefined &&
    cached.terrain === terrain &&
    cached.content === ctx.content &&
    cached.membershipGeneration === membershipGeneration &&
    cached.valueGeneration === valueGeneration
  ) {
    return cached.cells;
  }

  const cells = deriveBuildingBlockedCells(world, ctx.content, terrain);
  buildingBlockedCache.set(world, {
    membershipGeneration,
    valueGeneration,
    content: ctx.content,
    terrain,
    cells,
  });
  world.registerCacheVerifier('buildingBlockedCells', () =>
    verifyBuildingBlockedCache(world, ctx.content, terrain),
  );
  return cells;
}
