import {
  type BuildingFootprint,
  buildingFootprintFor,
  type ContentSet,
  type FootprintCell,
  footprintCellDx,
} from '@open-northland/data';
import { landscapeEditState } from '../../../components/landscape.js';
import { bioGroundWaived } from '../../../components/rules.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type PlacementGrid, placementBlockerGrid } from './blocker-grid.js';

// Building placement evaluates the blocker channels of ./blockers.ts over the one incrementally maintained
// count grid of ./blocker-grid.ts that the one-shot command gate and the per-frame overlay probe both read,
// so the two cannot disagree. The obstacle and building-zone counts hold the reserved-zone blockers, the
// exclusion and wall-body counts the body blockers.

/**
 * Whether `footprint` may be placed with its anchor at integer tile `(x, y)` against the stamped
 * {@link PlacementGrid}, the original's free placement rule: no grid fields, just collision plus a minimum
 * distance from blocking terrain and other houses, both encoded by the extracted footprint.
 *
 * source-basis: the footprint cells and the body/zone split are the extracted
 * `LogicWalkBlockArea`/`LogicBuildBlockArea` data. Original behavior, unconfirmed in the running game:
 * the test is crossed, a new house's top-level body against other houses' build areas and its build area
 * against their current bodies, so margin rings may overlap. Holding the rings disjoint is a deliberate
 * deviation: under the crossed rule a neighbour's upgrade can grow its body across a door exit, a recessed
 * door can be walled off by a body at the ring edge, and small buildings fit inside a wonder's courtyard,
 * each leaving a door no settler reaches.
 */
function canPlaceAnchor(
  grid: PlacementGrid,
  footprint: BuildingFootprint,
  buildOnBioPattern: boolean,
  x: number,
  y: number,
): boolean {
  const { terrain, obstacle, movableBody, exclusion, palisadeBody, buildingZone } = grid;
  const w = terrain.width;
  const h = terrain.height;
  // 1. Reserved zone - the max-level body plus the source's margin ring: on the map, on buildable ground,
  //    clear of OBSTACLE nodes and other buildings' reserved zones, so two buildings' reserved rings never
  //    overlap. Vehicles and signposts are discounted: placement pushes them aside.
  for (let i = 0; i < footprint.reserved.length; i++) {
    const c = footprint.reserved[i];
    if (c === undefined) continue;
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false; // blocking terrain too close
    const slot = cy * w + cx;
    if ((obstacle[slot] ?? 0) > (movableBody[slot] ?? 0) || (buildingZone[slot] ?? 0) > 0) return false;
  }
  // 2. Family body, the largest body the level chain reaches: clear of resource EXCLUSION zones and wall
  //    bodies, so placing level 0 already reserves the top level's space. familyBody ⊆ reserved, so loop 1
  //    already proved every cell in-bounds; the guard only shields a hand-authored footprint that breaks that.
  for (let i = 0; i < footprint.familyBody.length; i++) {
    const c = footprint.familyBody[i];
    if (c === undefined) continue;
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const slot = cy * w + cx;
    if ((exclusion[slot] ?? 0) > 0 || (palisadeBody[slot] ?? 0) > 0) return false;
  }
  // 3. `logicbuildonbiopattern`: wells and hives need grass (`plantable`) under their walk-block body.
  // Project rule: one body node on grass is enough, so a well or hive fits on the edge of a small patch.
  // The original tests every triangle around the body against its vegetation ground flags. An approximated
  // footprint has no walk-block body and so no ground to test.
  return (
    !buildOnBioPattern || footprint.blocked.length === 0 || bodyTouchesGrass(terrain, footprint.blocked, x, y)
  );
}

function bodyTouchesGrass(
  terrain: TerrainGraph,
  body: readonly FootprintCell[],
  x: number,
  y: number,
): boolean {
  for (const c of body) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (terrain.inBounds(cx, cy) && terrain.isPlantable(terrain.nodeAt(cx, cy))) return true;
  }
  return false;
}

/** A wall needs only its own cells: walkable ground clear of every body, whether a building, resource,
 * signpost or another wall. It keeps no margin, so a line runs between trees and stones and up to a
 * building's wall. With `overUpgradeGround` it may stand where a building only keeps room for its
 * upgrade, which razes it when it starts. Project rule. `allowance` names, per slot, the stamps a site
 * may stand over. */
export function canPlacePalisadeAnchor(
  grid: PlacementGrid,
  body: readonly FootprintCell[],
  x: number,
  y: number,
  overUpgradeGround = false,
  allowance?: (slot: number) => { readonly obstacle: number; readonly walls: number } | undefined,
): boolean {
  const { terrain, obstacle, palisadeBody, upgradeReserve } = grid;
  for (const c of body) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy) || !terrain.isWalkable(terrain.nodeAt(cx, cy))) return false;
    const slot = cy * terrain.width + cx;
    const allowed = allowance?.(slot);
    const waived = (overUpgradeGround ? (upgradeReserve[slot] ?? 0) : 0) + (allowed?.obstacle ?? 0);
    if ((obstacle[slot] ?? 0) > waived || (palisadeBody[slot] ?? 0) > (allowed?.walls ?? 0)) return false;
  }
  return true;
}

/**
 * Whether `tribe`'s building of `buildingType` may be placed with its anchor at integer tile `(x, y)`,
 * per the rule on {@link canPlaceAnchor}. A type without a footprint has no collision model; a bio-pattern
 * type still checks its anchor ground. Settlers, vehicles and signposts never block placement: placing
 * the foundation displaces them from its body.
 */
export function canPlaceBuilding(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  buildingType: number,
  tribe: number | undefined,
  x: number,
  y: number,
): boolean {
  const building = contentIndex(ctx.content).buildings.get(buildingType);
  const footprint = building === undefined ? undefined : buildingFootprintFor(building, tribe);
  const buildOnBioPattern = needsBioGround(world, building?.buildOnBioPattern);
  if (footprint === undefined) return canPlaceWithoutFootprint(world, terrain, buildOnBioPattern, x, y);
  return canPlaceAnchor(
    placementBlockerGrid(world, ctx.content, terrain),
    footprint,
    buildOnBioPattern,
    x,
    y,
  );
}

/** Whether a type's `buildOnBioPattern` ground demand applies, which the `BioGroundRules` debug rule
 *  waives. */
function needsBioGround(world: World, buildOnBioPattern: boolean | undefined): boolean {
  return buildOnBioPattern === true && !bioGroundWaived(world);
}

/** A type without a footprint has no collision model: its anchor only has to lie on the map, on a node no
 *  script closed to building, and on plantable ground for a bio-pattern type. */
function canPlaceWithoutFootprint(
  world: World,
  terrain: TerrainGraph,
  buildOnBioPattern: boolean,
  x: number,
  y: number,
): boolean {
  if (!terrain.inBounds(x, y)) return false;
  const node = terrain.nodeAt(x, y);
  return !landscapeEditState(world).forbidden.has(node) && (!buildOnBioPattern || terrain.isPlantable(node));
}

/** A ready-to-query buildability test for one building type, with its footprint resolved once. `canPlace`
 *  takes an anchor at integer tile coordinates. */
export interface PlacementProbe {
  canPlace(x: number, y: number): boolean;
}

/**
 * A {@link PlacementProbe} for `tribe`'s `buildingType` with its footprint resolved once, so a caller can
 * probe a whole band against the same rule the `placeBuilding` command gates on without re-resolving
 * content per cell. A footprint-less type has no collision rule but retains any bio-pattern ground restriction. The
 * probe reads the live shared count arrays, which the next blocker change updates in place, so drain a
 * probe's band before the world can change again.
 */
export function placementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
  tribe: number | undefined,
  record?: string,
): PlacementProbe {
  const building = contentIndex(content).buildings.get(buildingType);
  const footprint = building === undefined ? undefined : buildingFootprintFor(building, tribe, record);
  const buildOnBioPattern = needsBioGround(world, building?.buildOnBioPattern);
  if (footprint === undefined) {
    return { canPlace: (x, y) => canPlaceWithoutFootprint(world, terrain, buildOnBioPattern, x, y) };
  }
  const grid = placementBlockerGrid(world, content, terrain);
  return { canPlace: (x, y) => canPlaceAnchor(grid, footprint, buildOnBioPattern, x, y) };
}
