import { type BuildingFootprint, type ContentSet, footprintCellDx } from '@open-northland/data';
import { landscapeEditState } from '../../../components/landscape.js';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { landscapeView } from '../../landscape/view.js';
import { buildingFootprintOf } from '../geometry.js';
import { BUILDING_ZONE, EXCLUSION, eachBlockerCell, OBSTACLE, placementBlockerVersion } from './blockers.js';

// Building placement evaluates the blocker channels of ./blockers.ts over a version-memoized mask grid that
// the one-shot command gate and the per-frame overlay probe both read, so the two cannot disagree. The
// obstacle mask holds the reserved-zone blockers, the exclusion mask the body blockers.

/**
 * The dense blocker representation: one byte per half-cell node, row-major `y*width+x` like the index
 * `TerrainGraph.nodeAt` mints, `1` where that node blocks a reserved zone (OBSTACLE, BUILDING_ZONE) or a
 * body (EXCLUSION). Off-map blocker cells are never stamped: their `y*width+x` would alias onto a real tile
 * a row over, and the bounds check rejects an off-map candidate first. Terrain buildability stays a live
 * `isBuildable()` call.
 */
interface PlacementGrid {
  readonly terrain: TerrainGraph;
  readonly obstacle: Uint8Array;
  readonly exclusion: Uint8Array;
}

/**
 * Whether `footprint` may be placed with its anchor at integer tile `(x, y)` against the stamped
 * {@link PlacementGrid}, the original's free placement rule: no grid fields, just collision plus a minimum
 * distance from blocking terrain and other houses, both encoded by the extracted footprint.
 *
 * source-basis: the footprint cells and the body/zone split are the extracted
 * `LogicWalkBlockArea`/`LogicBuildBlockArea` data. The zone-vs-zone reading is a named approximation with
 * no oracle: holding the reserved rings disjoint matches observed settlement density, while letting them
 * overlap packs about twice as densely.
 */
function canPlaceAnchor(grid: PlacementGrid, footprint: BuildingFootprint, x: number, y: number): boolean {
  const { terrain, obstacle, exclusion } = grid;
  const w = terrain.width;
  const h = terrain.height;
  // 1. Reserved zone - the max-level body plus the source's margin ring: on the map, on buildable ground,
  //    clear of reserved-zone blockers (OBSTACLE nodes and other buildings' reserved zones, both in the
  //    obstacle mask), so two buildings' reserved rings never overlap.
  for (const c of footprint.reserved) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false; // blocking terrain too close
    if (obstacle[cy * w + cx] === 1) return false; // a resource body, a wall, or another reserved zone
  }
  // 2. Family body, the largest body the level chain reaches: clear of resource EXCLUSION zones, so placing
  //    level 0 already reserves the top level's space. familyBody ⊆ reserved, so loop 1 already proved
  //    every cell in-bounds; the guard only shields a hand-authored footprint that breaks that.
  for (const c of footprint.familyBody) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (cx >= 0 && cy >= 0 && cx < w && cy < h && exclusion[cy * w + cx] === 1) return false;
  }
  return true;
}

/** One full stamp of the blocker masks into an already-zeroed `grid` - the memo rebuild and the
 *  verifier's reference derivation run through this single path. */
function stampBlockerGrid(world: World, content: ContentSet, grid: PlacementGrid): void {
  const w = grid.terrain.width;
  const h = grid.terrain.height;
  const landscape = landscapeView(world, grid.terrain);
  for (const node of landscape.walk) grid.obstacle[node] = 1;
  for (const node of landscape.build) grid.exclusion[node] = 1;
  for (const node of landscapeEditState(world).forbidden.keys()) grid.obstacle[node] = 1;
  eachBlockerCell(world, content, (x, y, channel) => {
    if (channel !== OBSTACLE && channel !== EXCLUSION && channel !== BUILDING_ZONE) return;
    if (x < 0 || y < 0 || x >= w || y >= h) return; // off-map cells are never queried (see PlacementGrid)
    (channel === EXCLUSION ? grid.exclusion : grid.obstacle)[y * w + x] = 1;
  });
}

/**
 * Per-world memo of the placement grid, keyed by the {@link placementBlockerVersion} it was stamped at.
 * Without it every consumer re-scans every Resource and Building on the map. Keying on the blocker version
 * rather than the tick lets an unchanged world reuse the grid across ticks, and a direct `world.add` or
 * `remove` invalidates it the moment it bumps a generation. The mask arrays are reused across rebuilds of
 * the same world and terrain, so a rebuild clears and re-stamps instead of churning a map-sized allocation.
 */
interface GridMemo {
  version: string;
  content: ContentSet;
  terrain: TerrainGraph;
  grid: PlacementGrid;
  /** The verifier's reference buffers, reused across checked ticks since a real map is about 1M nodes. */
  scratch: PlacementGrid | undefined;
}
const gridMemo = new WeakMap<World, GridMemo>();

function emptyGrid(terrain: TerrainGraph): PlacementGrid {
  const size = terrain.width * terrain.height;
  return { terrain, obstacle: new Uint8Array(size), exclusion: new Uint8Array(size) };
}

/** The {@link gridMemo} coherence verifier: while the key claims freshness, a re-stamp must agree - the
 *  tripwire for a blocker input {@link placementBlockerVersion} fails to see (`verifyCaches`). */
function verifyGridMemo(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const held = gridMemo.get(world);
  if (held === undefined || held.content !== content || held.terrain !== terrain) return [];
  if (held.version !== placementBlockerVersion(world)) return []; // stale key - the next read re-stamps
  const fresh = held.scratch ?? emptyGrid(terrain);
  held.scratch = fresh;
  fresh.obstacle.fill(0);
  fresh.exclusion.fill(0);
  stampBlockerGrid(world, content, fresh);
  for (let i = 0; i < fresh.obstacle.length; i++) {
    if (held.grid.obstacle[i] === fresh.obstacle[i] && held.grid.exclusion[i] === fresh.exclusion[i]) {
      continue;
    }
    return [
      'placementBlockerGrid memo diverges from a fresh stamp - a blocker changed without a placementBlockerVersion bump',
    ];
  }
  return [];
}

function memoizedPlacementGrid(world: World, content: ContentSet, terrain: TerrainGraph): PlacementGrid {
  const version = placementBlockerVersion(world);
  const cached = gridMemo.get(world);
  if (
    cached !== undefined &&
    cached.version === version &&
    cached.content === content &&
    cached.terrain === terrain
  ) {
    return cached.grid;
  }
  const reuse = cached?.grid.terrain === terrain ? cached : undefined;
  const grid = reuse?.grid ?? emptyGrid(terrain);
  grid.obstacle.fill(0);
  grid.exclusion.fill(0);
  stampBlockerGrid(world, content, grid);
  gridMemo.set(world, { version, content, terrain, grid, scratch: reuse?.scratch });
  world.registerCacheVerifier('placementBlockerGrid', () => verifyGridMemo(world, content, terrain));
  return grid;
}

/**
 * Whether a building of `buildingType` may be placed with its anchor at integer tile `(x, y)`, per the rule
 * on {@link canPlaceAnchor}. A type without a footprint has no collision model and validates trivially.
 * Settlers never block placement: the foundation appears under them and they walk off.
 */
export function canPlaceBuilding(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  buildingType: number,
  x: number,
  y: number,
): boolean {
  const footprint = buildingFootprintOf(ctx.content, buildingType);
  if (footprint === undefined) return !landscapeEditState(world).forbidden.has(y * terrain.width + x);
  return canPlaceAnchor(memoizedPlacementGrid(world, ctx.content, terrain), footprint, x, y);
}

/** A ready-to-query buildability test for one building type, with its footprint resolved once. `canPlace`
 *  takes an anchor at integer tile coordinates. */
export interface PlacementProbe {
  canPlace(x: number, y: number): boolean;
}

/**
 * A {@link PlacementProbe} for `buildingType` with its footprint resolved once, so a caller can probe a
 * whole band against the same rule the `placeBuilding` command gates on without re-resolving content per
 * cell. A footprint-less type always reports placeable, matching its command-time behavior. The probe
 * reads the memo's shared mask arrays, which are re-stamped in place on the next blocker change, so drain
 * a probe's band before the world can change again.
 */
export function placementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
): PlacementProbe {
  const footprint = buildingFootprintOf(content, buildingType);
  if (footprint === undefined)
    return { canPlace: (x, y) => !landscapeEditState(world).forbidden.has(y * terrain.width + x) };
  const grid = memoizedPlacementGrid(world, content, terrain);
  return { canPlace: (x, y) => canPlaceAnchor(grid, footprint, x, y) };
}
