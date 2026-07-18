import type { ContentSet } from '@open-northland/data';
import { Building, Position } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, sameCells, translatedCells } from './geometry.js';

// The memoized per-world cache of cells standing buildings make unwalkable, plus its coherence
// verifier — the building twin of ./resource-blocked-cache.ts. A call burst (an authored map load's
// spawn pushes, a box-select's move orders) shares one build instead of re-scanning the Building
// store per call.

interface BuildingBlockedCache {
  /** Building MEMBERSHIP generation (add/remove/destroy) the cells were derived at. */
  membershipGeneration: number;
  /** Building VALUE generation: the in-place `buildingType` swap of a home tier upgrade changes the
   *  cell set with no membership bump, so the upgrade seam's `touchComponent(Building)` must also key
   *  this cache. The only other in-place Building write, `built` progress, never moves the cells (the
   *  walk-block applies from the placement tick) — its extra bumps just cost a cheap rebuild. */
  valueGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
}

const buildingBlockedCache = new WeakMap<World, BuildingBlockedCache>();

/** One full derivation — the rebuild and the verifier's reference run through this single path. */
function deriveBuildingBlockedCells(world: World, content: ContentSet, terrain: TerrainGraph): Set<NodeId> {
  const blocked = new Set<NodeId>();
  // Door cells collected separately and removed at the end: two buildings can overlap only via the
  // door-in-reserved margin, and a door must stay passable regardless of which building contributed
  // the wall cell (union first, subtract after — order-independent either way).
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
    if (door !== undefined && terrain.inBounds(ax + door.dx, ay + door.dy)) {
      doors.add(terrain.nodeAt(ax + door.dx, ay + door.dy));
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
    return []; // stale key — the next read rebuilds, nothing can consume the old cells
  }
  const fresh = deriveBuildingBlockedCells(world, content, terrain);
  if (sameCells(cached.cells, fresh)) return [];
  return [
    `buildingBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} — a Building changed in place without a touchComponent(Building) bump`,
  ];
}

/**
 * The cells standing buildings make UNWALKABLE right now — the union of every placed building's
 * `footprint.blocked` cells (its CURRENT level's walls). The walk-block applies from the placement
 * tick: a grey foundation already occupies its cells, exactly like the original.
 *
 * A building's own DOOR cell is always left walkable, even when the source lists it inside the
 * walk-block — the real data does exactly that for the defence-wall gate (`work_pottery_02`'s
 * `LogicDoorPoint` sits inside its `LogicWalkBlockArea`: a wall's door IS its passable gate). Without
 * this carve-out the walk-to-door goal would be a blocked cell → `findPath` fails → the request is
 * never re-issued → the settler wedges permanently. The extractor keeps the source cells verbatim
 * (provenance); the consumer applies the gate semantics.
 *
 * DERIVED state — never hashed, never stored on an entity. Memoized per world against the Building
 * store's membership AND value generations (the home tier upgrade swaps `buildingType` in place under
 * `touchComponent(Building)` — see the cache key doc), so a burst of callers between two building
 * mutations shares one O(buildings × footprint cells) build. The returned set is the SHARED cached
 * copy: membership reads only — a caller that must mutate copies first ({@link dynamicBlockedCells}).
 * Determinism: a set union over `world.query` — order-independent (membership only, no pick; the door
 * carve-out is per-building, keyed to its own cells), so store-order iteration is fine.
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
