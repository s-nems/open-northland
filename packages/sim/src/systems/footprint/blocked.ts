import { BUILDING_KIND, type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Position, UnderConstruction } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { heldBuildingTypesStand, type WalkBody, walkBodyOf } from './building-blocked-cache.js';
import { ANCHOR_ONLY, houseFootprintOf } from './geometry.js';
import { walkBlockMask } from './walk-block-mask.js';

// Walk-block overlays for routing and render, over the memoized building cells and the incrementally
// cached resource cells. Derived state, never hashed.

/** One under-construction building's ground plot, for the render's construction-site decal. Cells are
 *  `(col, row)` half-cell nodes, the coords `halfCellToScreen` projects. */
export interface ConstructionPlot {
  readonly ref: number;
  /** Whether the site lays a foundation: a house does, a vehicle's yard builds on the ground or water as
   *  it lies. */
  readonly foundation: boolean;
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

/** The plots last derived for a world, with the generations and site types they hold for. */
interface ConstructionPlotMemo {
  readonly content: ContentSet;
  readonly siteGeneration: number;
  readonly buildingGeneration: number;
  buildingValueGeneration: number;
  readonly types: ReadonlyMap<Entity, number>;
  readonly plots: readonly ConstructionPlot[];
}

const constructionPlotMemo = new WeakMap<World, ConstructionPlotMemo>();

/** The ground plots of every under-construction building: its footprint body cells translated onto world
 *  half-cell nodes, unfiltered by the grid bounds, or the bare anchor cell for a footprint-less type. The
 *  same array comes back until a site is added, finished, removed or retyped, so a per-frame reader can
 *  key on its identity. */
export function constructionSitePlots(world: World, content: ContentSet): readonly ConstructionPlot[] {
  const siteGeneration = world.componentGeneration(UnderConstruction);
  const buildingGeneration = world.componentGeneration(Building);
  const buildingValueGeneration = world.componentValueGeneration(Building);
  const memo = constructionPlotMemo.get(world);
  if (
    memo !== undefined &&
    memo.content === content &&
    memo.siteGeneration === siteGeneration &&
    memo.buildingGeneration === buildingGeneration &&
    heldBuildingTypesStand(world, memo.types, memo.buildingValueGeneration)
  ) {
    memo.buildingValueGeneration = buildingValueGeneration;
    return memo.plots;
  }
  world.journalValueWrites(Building);
  const types = new Map<Entity, number>();
  const plots: ConstructionPlot[] = [];
  const buildings = contentIndex(content).buildings;
  for (const e of world.query(UnderConstruction, Building, Position)) {
    const b = world.get(e, Building);
    types.set(e, b.buildingType);
    const footprint = houseFootprintOf(content, b);
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const body = footprint !== undefined && footprint.blocked.length > 0 ? footprint.blocked : ANCHOR_ONLY;
    plots.push({
      ref: e,
      foundation: buildings.get(b.buildingType)?.kind !== BUILDING_KIND.vehicle,
      cells: body.map((c) => ({ col: hx + footprintCellDx(hy, c), row: hy + c.dy })),
    });
  }
  constructionPlotMemo.set(world, {
    content,
    siteGeneration,
    buildingGeneration,
    buildingValueGeneration,
    types,
    plots,
  });
  return plots;
}

/** One building's {@link WalkBody} on the map, or null when the type blocks nothing. */
export function buildingWalkBodyOf(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  building: Entity,
): WalkBody | null {
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return null;
  const footprint = houseFootprintOf(ctx.content, b);
  if (footprint === undefined || footprint.blocked.length === 0) return null;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  return walkBodyOf(terrain, footprint, hx, hy);
}

/** One building's walk-blocked body: its footprint `blocked` cells on the map minus its door passage, or
 *  null when the type blocks nothing. A displacement search may cross this body but no other blocked cell. */
export function walkBlockedBodyOf(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  building: Entity,
): Set<NodeId> | null {
  const walk = buildingWalkBodyOf(world, ctx, terrain, building);
  return walk === null || walk.body.size === 0 ? null : walk.body;
}

/** The dynamic walk-block overlay settlers route under (buildings, resources, landscapes): the world's one
 *  live byte-per-node union of those layers. Standing vehicles are not in it: settlers walk through them,
 *  as in the original. */
export function dynamicBlockOverlay(world: World, ctx: ContentContext, terrain: TerrainGraph): BlockOverlay {
  return walkBlockMask(world, ctx, terrain);
}
