import { type BuildingFootprint, type ContentSet, footprintCellDx } from '@open-northland/data';
import { landscapeEditState } from '../../../components/landscape.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type PlacementGrid, placementBlockerGrid } from './blocker-grid.js';

// Building placement evaluates the blocker channels of ./blockers.ts over the one incrementally maintained
// count grid of ./blocker-grid.ts that the one-shot command gate and the per-frame overlay probe both read,
// so the two cannot disagree. The obstacle counts hold the reserved-zone blockers, the exclusion counts the
// body blockers.

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
export function canPlaceAnchor(
  grid: PlacementGrid,
  footprint: BuildingFootprint,
  buildOnBioPattern: boolean,
  x: number,
  y: number,
): boolean {
  const { terrain, obstacle, exclusion, palisadeBody, palisadeZone } = grid;
  const w = terrain.width;
  const h = terrain.height;
  // 1. Reserved zone - the max-level body plus the source's margin ring: on the map, on buildable ground,
  //    clear of reserved-zone blockers (OBSTACLE nodes and other buildings' reserved zones, both in the
  //    obstacle counts), so two buildings' reserved rings never overlap.
  for (const c of footprint.reserved) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false; // blocking terrain too close
    const slot = cy * w + cx;
    if ((obstacle[slot] ?? 0) > 0 || (palisadeBody[slot] ?? 0) > 0 || (palisadeZone[slot] ?? 0) > 0)
      return false;
  }
  // 2. Family body, the largest body the level chain reaches: clear of resource EXCLUSION zones, so placing
  //    level 0 already reserves the top level's space. familyBody ⊆ reserved, so loop 1 already proved
  //    every cell in-bounds; the guard only shields a hand-authored footprint that breaks that.
  for (const c of footprint.familyBody) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (cx >= 0 && cy >= 0 && cx < w && cy < h && (exclusion[cy * w + cx] ?? 0) > 0) return false;
  }
  // 3. `logicbuildonbiopattern` checks the walk-block body against the source's vegetation ground flags.
  // The original tests every surrounding triangle; the collision join conservatively collapses each
  // cell's two triangles into `plantable`, so wells and hives accept grass and reject sand/plaster.
  if (buildOnBioPattern) {
    for (const c of footprint.blocked) {
      const cx = x + footprintCellDx(y, c);
      const cy = y + c.dy;
      if (!terrain.inBounds(cx, cy) || !terrain.isPlantable(terrain.nodeAt(cx, cy))) return false;
    }
  }
  return true;
}

/** Palisade placement uses the building rule except that adjacent palisade build margins may overlap.
 * Existing wall bodies still reject the candidate's own walk cells, preventing duplicate segments. */
export function canPlacePalisadeAnchor(
  grid: PlacementGrid,
  footprint: BuildingFootprint,
  x: number,
  y: number,
): boolean {
  const { terrain, obstacle, exclusion, palisadeBody } = grid;
  const w = terrain.width;
  const h = terrain.height;
  for (const c of footprint.reserved) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false;
    if ((obstacle[cy * w + cx] ?? 0) > 0) return false;
  }
  for (const c of footprint.familyBody) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    const slot = cy * w + cx;
    if ((exclusion[slot] ?? 0) > 0 || (palisadeBody[slot] ?? 0) > 0) return false;
  }
  return true;
}

/**
 * Whether a building of `buildingType` may be placed with its anchor at integer tile `(x, y)`, per the rule
 * on {@link canPlaceAnchor}. A type without a footprint has no collision model; a bio-pattern type still
 * checks its anchor ground. Settlers never block placement: the foundation appears under them and they
 * walk off.
 */
export function canPlaceBuilding(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  buildingType: number,
  x: number,
  y: number,
): boolean {
  const building = contentIndex(ctx.content).buildings.get(buildingType);
  const footprint = building?.footprint;
  const buildOnBioPattern = building?.buildOnBioPattern === true;
  if (footprint === undefined) {
    return (
      !scriptForbids(world, terrain, x, y) &&
      (!buildOnBioPattern || (terrain.inBounds(x, y) && terrain.isPlantable(terrain.nodeAt(x, y))))
    );
  }
  return canPlaceAnchor(
    placementBlockerGrid(world, ctx.content, terrain),
    footprint,
    buildOnBioPattern,
    x,
    y,
  );
}

/** Whether a script closed the node to building; a node off the map is nobody's to forbid. */
function scriptForbids(world: World, terrain: TerrainGraph, x: number, y: number): boolean {
  return terrain.inBounds(x, y) && landscapeEditState(world).forbidden.has(terrain.nodeAt(x, y));
}

/** A ready-to-query buildability test for one building type, with its footprint resolved once. `canPlace`
 *  takes an anchor at integer tile coordinates. */
export interface PlacementProbe {
  canPlace(x: number, y: number): boolean;
}

/**
 * A {@link PlacementProbe} for `buildingType` with its footprint resolved once, so a caller can probe a
 * whole band against the same rule the `placeBuilding` command gates on without re-resolving content per
 * cell. A footprint-less type has no collision rule but retains any bio-pattern ground restriction. The
 * probe reads the live shared count arrays, which the next blocker change updates in place, so drain a
 * probe's band before the world can change again.
 */
export function placementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
): PlacementProbe {
  const building = contentIndex(content).buildings.get(buildingType);
  const footprint = building?.footprint;
  const buildOnBioPattern = building?.buildOnBioPattern === true;
  if (footprint === undefined) {
    return {
      canPlace: (x, y) =>
        !scriptForbids(world, terrain, x, y) &&
        (!buildOnBioPattern || (terrain.inBounds(x, y) && terrain.isPlantable(terrain.nodeAt(x, y)))),
    };
  }
  const grid = placementBlockerGrid(world, content, terrain);
  return {
    canPlace: (x, y) => canPlaceAnchor(grid, footprint, buildOnBioPattern, x, y),
  };
}
