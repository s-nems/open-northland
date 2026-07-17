import type { BuildingFootprint, ContentSet } from '@open-northland/data';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingFootprintOf, nodeKey } from '../geometry.js';
import { EXCLUSION, eachBlockerCell, OBSTACLE, placementBlockerVersion } from './blockers.js';

// BUILDING PLACEMENT — the can-this-building-go-here check: the original's FREE placement rule (collision +
// a minimum distance encoded by the extracted footprint) evaluated over the OBSTACLE/EXCLUSION channels of
// ./blockers.ts, in a sparse string form for the one-shot command gate and a dense mask form for the
// per-frame overlay probe, both stamped from ONE {@link eachBlockerCell} pass so they can never disagree.

/**
 * The command-gate obstacle sets — one throwaway per {@link canPlaceBuilding} check (which probes a
 * SINGLE anchor). Injective string {@link nodeKey}s, NOT a numeric `y*width+x` packing (which would
 * alias an off-map cell onto a real tile a row over — a footprint-less building at a negative
 * coordinate would then falsely reject a distant placement). The overlay probes thousands of anchors
 * per frame, so it uses the dense-mask twin ({@link PlacementGrid}) instead.
 */
interface PlacementBlockers {
  readonly terrain: TerrainGraph;
  readonly obstacles: Set<string>;
  readonly exclusions: Set<string>;
}

function collectPlacementBlockers(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): PlacementBlockers {
  const obstacles = new Set<string>();
  const exclusions = new Set<string>();
  eachBlockerCell(world, content, (x, y, channel) => {
    if (channel === OBSTACLE) obstacles.add(nodeKey(x, y));
    else if (channel === EXCLUSION) exclusions.add(nodeKey(x, y));
  });
  return { terrain, obstacles, exclusions };
}

/**
 * Whether `footprint` may be placed with its anchor at integer tile `(x,y)` against the precomputed
 * {@link PlacementBlockers} — the original's FREE placement rule: no grid fields, just collision +
 * a minimum distance from blocking terrain and other houses, both encoded by the extracted footprint.
 * Valid iff:
 *
 *  1. every cell of the `reserved` zone (the build-exclusion area — the max-level body plus the
 *     source's margin ring) is on the map and on BUILDABLE terrain (the landscape row's `buildable`
 *     flag: water/rock/void may not touch the zone; a real map's tree/rock margin band is walkable
 *     ground that still rejects here), clear of resource walk-block bodies, and clear of every
 *     existing building's walls;
 *  2. the new building's `familyBody` (the largest body its level chain reaches — placing level 0
 *     reserves the top level's space) stays out of every resource build-zone and every existing
 *     building's reserved zone. The body-vs-zone test is symmetric, so each house keeps every other
 *     house's walls at least its own margin away — but two margins may overlap, so houses still pack
 *     closely (the original's "very free" placement).
 *
 * source-basis: the footprint cells and the body/zone split are the extracted
 * `LogicWalkBlockArea`/`LogicBuildBlockArea` data (faithful); the exact overlap rule (body-vs-zone
 * symmetric, zones may overlap) is approximated — our reading of those two areas, since the engine's check
 * has no oracle.
 */
function canPlaceAnchor(
  blockers: PlacementBlockers,
  footprint: BuildingFootprint,
  x: number,
  y: number,
): boolean {
  const { terrain } = blockers;
  // 1. The reserved zone must lie on the map, on buildable ground, and clear of node/wall OBSTACLES.
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy)) return false; // zone off the map edge
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false; // blocking terrain too close
    if (blockers.obstacles.has(nodeKey(cx, cy))) return false; // a resource body or a building's walls
  }
  // 2. My family body must stay clear of resource + building EXCLUSION zones (the symmetric margin).
  for (const c of footprint.familyBody) {
    if (blockers.exclusions.has(nodeKey(x + c.dx, y + c.dy))) return false;
  }
  return true;
}

/**
 * Whether a building of `buildingType` may be placed with its anchor at integer tile `(x, y)`. A
 * `buildingType` without a footprint validates trivially (no collision model — the pre-footprint
 * behavior synthetic content keeps). Settlers never block placement (the foundation appears under
 * them and they walk off — the walls only enter the nav overlay, {@link buildingBlockedCells}).
 * The rule and its source basis live on {@link canPlaceAnchor}; this builds a one-shot
 * {@link PlacementBlockers} for the single command-time check.
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
  if (footprint === undefined) return true; // no collision model — places freely (synthetic content)
  return canPlaceAnchor(collectPlacementBlockers(world, ctx.content, terrain), footprint, x, y);
}

/** A ready-to-query buildability test for ONE building type: the type's footprint resolved against a
 *  precomputed snapshot of the world's obstacle sets. Built once (see {@link placementProbe}) and then
 *  asked `canPlace(x,y)` per tile — the placement-overlay's screen-bounded seam. */
export interface PlacementProbe {
  /** Whether a building of the probed type may be placed with its anchor at integer tile `(x, y)`. */
  canPlace(x: number, y: number): boolean;
}

/**
 * The overlay's DENSE obstacle representation: one byte per half-cell node (`terrain.width×height`,
 * row-major `y*width+x` — the same index `TerrainGraph.nodeAt` mints), `1` iff that node is an
 * OBSTACLE / EXCLUSION cell. Stamped from the same {@link eachBlockerCell} pass the command gate keys
 * as strings, but read back as an O(1) typed-array index in the hot loop instead of a `nodeKey`
 * string allocation + `Set<string>` probe — the difference that lets the overlay re-probe a whole
 * visible band (screen × footprint) without stalling a frame, even for a many-hundred-cell footprint.
 * Off-map blocker cells are simply not stamped — a candidate whose reserved cell is off-map is rejected
 * by the bounds check first, so they can never be queried. Terrain buildability stays a live
 * `isBuildable()` call (static, already a grid). */
interface PlacementGrid {
  readonly terrain: TerrainGraph;
  readonly obstacle: Uint8Array;
  readonly exclusion: Uint8Array;
}

/** The dense twin of {@link canPlaceAnchor} — same rule, read from the mask grid. Kept in lockstep
 *  with the sparse version by the `placementProbe matches canPlaceBuilding at every anchor` test. */
function canPlaceOnGrid(grid: PlacementGrid, footprint: BuildingFootprint, x: number, y: number): boolean {
  const { terrain, obstacle, exclusion } = grid;
  const w = terrain.width;
  const h = terrain.height;
  // 1. Reserved zone: on the map, on buildable ground, clear of OBSTACLE nodes.
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false; // zone off the map edge
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false; // blocking terrain too close
    if (obstacle[cy * w + cx] === 1) return false; // a resource body or a building's walls
  }
  // 2. Family body: clear of EXCLUSION zones. familyBody ⊆ reserved, so every cell here is already
  //    proven in-bounds by loop 1 — the guard only shields a hand-authored footprint that breaks that.
  for (const c of footprint.familyBody) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (cx >= 0 && cy >= 0 && cx < w && cy < h && exclusion[cy * w + cx] === 1) return false;
  }
  return true;
}

/**
 * Per-world memo of the overlay's dense placement grid, keyed by the {@link placementBlockerVersion} it
 * was stamped at. The overlay probes it every RAF frame (frames outrun ticks; a paused/hovering build
 * never ticks) — without the memo each frame would re-scan every Resource + Building on the map (an
 * O(entities) whole-map pass per frame — the perf/architecture review's finding). Keying on the blocker
 * version (not the tick) means a running sim whose buildings/resources are unchanged reuses the grid
 * across ticks too, and a DIRECT `world.add`/`remove` (the fixture idiom) invalidates it the moment it
 * bumps a generation. The mask arrays are REUSED across rebuilds (same world+terrain) — a resource
 * depleting mid-placement clears + re-stamps rather than churning a map-sized allocation. A pure
 * read-path cache: it feeds only the app overlay, never a sim decision, so it is not hashed and needs
 * no `verifyCaches` registration. Built lazily on the first probe, so it costs nothing outside build mode.
 */
interface GridMemo {
  version: string;
  content: ContentSet;
  terrain: TerrainGraph;
  grid: PlacementGrid;
}
const gridMemo = new WeakMap<World, GridMemo>();

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
  const size = terrain.width * terrain.height;
  let grid: PlacementGrid;
  if (cached?.grid.terrain === terrain && cached.grid.obstacle.length === size) {
    // Reuse last grid's arrays (terrain never changes per world), so a rebuild is a clear + re-stamp,
    // not a fresh map-sized allocation churned every time a resource depletes mid-placement.
    cached.grid.obstacle.fill(0);
    cached.grid.exclusion.fill(0);
    grid = cached.grid;
  } else {
    grid = { terrain, obstacle: new Uint8Array(size), exclusion: new Uint8Array(size) };
  }
  const w = terrain.width;
  const h = terrain.height;
  eachBlockerCell(world, content, (x, y, channel) => {
    if (channel !== OBSTACLE && channel !== EXCLUSION) return;
    if (x < 0 || y < 0 || x >= w || y >= h) return; // off-map cells are never queried (see canPlaceOnGrid)
    (channel === OBSTACLE ? grid.obstacle : grid.exclusion)[y * w + x] = 1;
  });
  gridMemo.set(world, { version, content, terrain, grid });
  return grid;
}

/**
 * Build a {@link PlacementProbe} for `buildingType` — resolve its footprint and snapshot the world's
 * obstacle cells into a dense mask grid, so the app's build-mode overlay can probe every visible tile
 * against the exact same rule the `placeBuilding` command gates on ({@link canPlaceBuilding}), reading
 * O(1) typed-array masks instead of re-scanning the world per cell. The grid is memoized per
 * {@link placementBlockerVersion}, so it is re-stamped only when a building/resource actually appears
 * or disappears — not every tick, and not every frame while the world is unchanged. A footprint-less
 * type always reports placeable (its command-time behavior).
 *
 * The returned probe reads the memo's SHARED mask arrays, which are re-stamped IN PLACE on the next
 * blocker change — so drain a probe's band before the world can change again. The frame loop probes one
 * type synchronously each frame, so it never holds two probes across a rebuild; a second concurrent
 * consumer would need its own grid.
 */
export function placementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
): PlacementProbe {
  const footprint = buildingFootprintOf(content, buildingType);
  if (footprint === undefined) return { canPlace: () => true };
  const grid = memoizedPlacementGrid(world, content, terrain);
  return { canPlace: (x, y) => canPlaceOnGrid(grid, footprint, x, y) };
}
