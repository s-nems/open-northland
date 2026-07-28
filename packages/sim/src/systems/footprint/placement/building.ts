import type { BuildingFootprint, ContentSet } from '@open-northland/data';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingFootprintOf } from '../geometry.js';
import { BUILDING_ZONE, EXCLUSION, eachBlockerCell, OBSTACLE, placementBlockerVersion } from './blockers.js';

// BUILDING PLACEMENT — the can-this-building-go-here check: the original's FREE placement rule (collision +
// a minimum distance encoded by the extracted footprint) evaluated over the blocker channels of
// ./blockers.ts, stamped ONCE into a version-memoized mask grid that both the one-shot command gate and
// the per-frame overlay probe read, so the two can never disagree and neither pays an O(map) scan per probe.
//
// Two masks drive the rule: the RESERVED-zone blockers (OBSTACLE + other buildings' BUILDING_ZONE — cells a
// candidate's reserved ring may not touch) and the BODY blockers (resource EXCLUSION — cells its walls may
// not touch).

/**
 * The DENSE blocker representation: one byte per half-cell node (`terrain.width×height`, row-major
 * `y*width+x` — the same index `TerrainGraph.nodeAt` mints), `1` iff that node is a reserved-zone blocker
 * (OBSTACLE + BUILDING_ZONE) / a body blocker (EXCLUSION). Read back as an O(1) typed-array index, which is
 * what lets the overlay re-probe a whole visible band (screen × footprint) without stalling a frame, even
 * for a many-hundred-cell footprint. Off-map blocker cells are NOT stamped: their `y*width+x` would alias
 * onto a real tile a row over, and a candidate whose reserved cell is off-map is rejected by the bounds
 * check first, so no query can reach them. Terrain buildability stays a live `isBuildable()` call
 * (static, already a grid).
 */
interface PlacementGrid {
  readonly terrain: TerrainGraph;
  readonly obstacle: Uint8Array;
  readonly exclusion: Uint8Array;
}

/**
 * Whether `footprint` may be placed with its anchor at integer tile `(x,y)` against the stamped
 * {@link PlacementGrid} — the original's FREE placement rule: no grid fields, just collision + a minimum
 * distance from blocking terrain and other houses, both encoded by the extracted footprint. Valid iff:
 *
 *  1. every cell of the `reserved` zone (the build-exclusion area — the max-level body plus the
 *     source's margin ring) is on the map and on BUILDABLE terrain (the landscape row's `buildable`
 *     flag: water/rock/void may not touch the zone; a real map's tree/rock margin band is walkable
 *     ground that still rejects here), clear of resource walk-block bodies, clear of every existing
 *     building's walls, AND clear of every existing building's reserved zone (zone-vs-zone: two
 *     buildings' reserved rings may not overlap, so each house keeps every other house a full pair of
 *     margins away);
 *  2. the new building's `familyBody` (the largest body its level chain reaches — placing level 0
 *     reserves the top level's space) stays out of every resource build-zone.
 *
 * source-basis: the footprint cells and the body/zone split are the extracted
 * `LogicWalkBlockArea`/`LogicBuildBlockArea` data (faithful). The zone-vs-zone reading of two reserved
 * areas is a named gameplay approximation: the engine's check has no oracle, and the earlier body-vs-zone
 * reading (zones allowed to overlap) let settlements pack about twice as densely as the observed original,
 * so the reserved rings — the source's own "minimum distance from other houses" — are held disjoint instead.
 */
function canPlaceAnchor(grid: PlacementGrid, footprint: BuildingFootprint, x: number, y: number): boolean {
  const { terrain, obstacle, exclusion } = grid;
  const w = terrain.width;
  const h = terrain.height;
  // 1. Reserved zone: on the map, on buildable ground, clear of reserved-zone blockers (OBSTACLE nodes
  //    and other buildings' reserved zones — both stamped into the obstacle mask).
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false; // zone off the map edge
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false; // blocking terrain too close
    if (obstacle[cy * w + cx] === 1) return false; // a resource body, a wall, or another reserved zone
  }
  // 2. Family body: clear of resource EXCLUSION zones. familyBody ⊆ reserved, so every cell here is already
  //    proven in-bounds by loop 1 — the guard only shields a hand-authored footprint that breaks that.
  for (const c of footprint.familyBody) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (cx >= 0 && cy >= 0 && cx < w && cy < h && exclusion[cy * w + cx] === 1) return false;
  }
  return true;
}

/** One full stamp of the blocker masks into an already-zeroed `grid` — the memo rebuild and the
 *  verifier's reference derivation run through this single path. */
function stampBlockerGrid(world: World, content: ContentSet, grid: PlacementGrid): void {
  const w = grid.terrain.width;
  const h = grid.terrain.height;
  eachBlockerCell(world, content, (x, y, channel) => {
    if (channel !== OBSTACLE && channel !== EXCLUSION && channel !== BUILDING_ZONE) return;
    if (x < 0 || y < 0 || x >= w || y >= h) return; // off-map cells are never queried (see PlacementGrid)
    // OBSTACLE and BUILDING_ZONE both reject a reserved zone → the obstacle mask; EXCLUSION rejects a body.
    (channel === EXCLUSION ? grid.exclusion : grid.obstacle)[y * w + x] = 1;
  });
}

/**
 * Per-world memo of the placement grid, keyed by the {@link placementBlockerVersion} it was stamped at.
 * Without it every consumer re-scans every Resource + Building on the map: the overlay once per RAF frame
 * (frames outrun ticks; a paused/hovering build never ticks), the `placeBuilding` command gate once per
 * probed anchor. Keying on the blocker version (not the tick) means a running sim whose
 * buildings/resources are unchanged reuses the grid across ticks too, and a DIRECT `world.add`/`remove`
 * (the fixture idiom) invalidates it the moment it bumps a generation.
 *
 * The mask arrays are REUSED across rebuilds (same world+terrain) — a resource depleting mid-placement
 * clears + re-stamps rather than churning a map-sized allocation. Rebuild-on-bump, so it cannot drift by
 * a missed patch; the residual risk is the KEY missing an input, which is what the registered
 * `verifyCaches` verifier trips on — load-bearing, since the grid decides a `placeBuilding` command and
 * the AI's build-order spot search. Built lazily on the first probe, so a sim that never places costs
 * nothing; `scratch` is minted lazily on top of that, so only a verified run pays for it.
 */
interface GridMemo {
  version: string;
  content: ContentSet;
  terrain: TerrainGraph;
  grid: PlacementGrid;
  /** The verifier's reference buffers, reused across checked ticks (`verifyCaches` runs every tick of an
   *  invariant-checked run, and a real map is ~1M nodes). */
  scratch: PlacementGrid | undefined;
}
const gridMemo = new WeakMap<World, GridMemo>();

function emptyGrid(terrain: TerrainGraph): PlacementGrid {
  const size = terrain.width * terrain.height;
  return { terrain, obstacle: new Uint8Array(size), exclusion: new Uint8Array(size) };
}

/** The {@link gridMemo} coherence verifier: while the key claims freshness, a re-stamp must agree — the
 *  tripwire for a blocker input {@link placementBlockerVersion} fails to see (`verifyCaches`). */
function verifyGridMemo(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const held = gridMemo.get(world);
  if (held === undefined || held.content !== content || held.terrain !== terrain) return [];
  if (held.version !== placementBlockerVersion(world)) return []; // stale key — the next read re-stamps
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
      'placementBlockerGrid memo diverges from a fresh stamp — a blocker changed without a placementBlockerVersion bump',
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
  // Reuse the last grid's arrays when it was sized for this same terrain, so a rebuild is a clear +
  // re-stamp, not a fresh map-sized allocation churned every time a resource depletes mid-placement.
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
 * Whether a building of `buildingType` may be placed with its anchor at integer tile `(x, y)`. A
 * `buildingType` without a footprint validates trivially (no collision model — the pre-footprint
 * behavior synthetic content keeps). Settlers never block placement (the foundation appears under
 * them and they walk off — the walls only enter the nav overlay, {@link buildingBlockedCells}).
 * The rule and its source basis live on {@link canPlaceAnchor}.
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
  return canPlaceAnchor(memoizedPlacementGrid(world, ctx.content, terrain), footprint, x, y);
}

/** A ready-to-query buildability test for ONE building type: its footprint resolved once (see
 *  {@link placementProbe}), then asked `canPlace(x,y)` per node — the bounded-band seam the build
 *  overlay and the AI's spot search share. */
export interface PlacementProbe {
  /** Whether a building of the probed type may be placed with its anchor at integer tile `(x, y)`. */
  canPlace(x: number, y: number): boolean;
}

/**
 * Build a {@link PlacementProbe} for `buildingType` — resolve its footprint once so the app's build-mode
 * overlay and the AI's spot search can probe a whole band against the exact same rule the `placeBuilding`
 * command gates on ({@link canPlaceBuilding}), without re-resolving content per cell. A footprint-less
 * type always reports placeable (its command-time behavior).
 *
 * The returned probe reads the memo's SHARED mask arrays, which are re-stamped IN PLACE on the next
 * blocker change — so drain a probe's band before the world can change again. The frame loop probes one
 * type synchronously each frame and the AI's search does not mutate, so neither holds a probe across a
 * rebuild; a consumer that needs to would need its own grid.
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
  return { canPlace: (x, y) => canPlaceAnchor(grid, footprint, x, y) };
}
