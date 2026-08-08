import { type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Position, UnderConstruction } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type BlockOverlay, LayeredBlocks } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingBlockedCells } from './building-blocked-cache.js';
import { ANCHOR_ONLY, buildingFootprintOf, translatedCells } from './geometry.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';

// Walk-block overlays for routing and render, over the memoized building cells and the incrementally
// cached resource cells. Derived state, never hashed. The views alias the live caches, so a holder must
// not span a stamp or unstamp.

/** Every standing building's door node - the passable gates {@link buildingBlockedCells} carves out of the
 *  walk-block. */
export function buildingDoorNodes(world: World, ctx: SystemContext, terrain: TerrainGraph): Set<NodeId> {
  const doors = new Set<NodeId>();
  for (const e of world.query(Building, Position)) {
    const door = buildingFootprintOf(ctx.content, world.get(e, Building).buildingType)?.door;
    if (door === undefined) continue;
    const p = world.get(e, Position);
    const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
    const doorX = ax + footprintCellDx(ay, door);
    if (terrain.inBounds(doorX, ay + door.dy)) doors.add(terrain.nodeAt(doorX, ay + door.dy));
  }
  return doors;
}

/** One under-construction building's ground plot, for the render's construction-site decal. Cells are
 *  `(col, row)` half-cell nodes, the coords `halfCellToScreen` projects. */
export interface ConstructionPlot {
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

/** The ground plots of every under-construction building: its footprint body cells translated onto world
 *  half-cell nodes, unfiltered by the grid bounds, or the bare anchor cell for a footprint-less type. */
export function constructionSitePlots(world: World, content: ContentSet): ConstructionPlot[] {
  const plots: ConstructionPlot[] = [];
  for (const e of world.query(UnderConstruction, Building, Position)) {
    const b = world.get(e, Building);
    const footprint = buildingFootprintOf(content, b.buildingType);
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const body = footprint !== undefined && footprint.blocked.length > 0 ? footprint.blocked : ANCHOR_ONLY;
    plots.push({ cells: body.map((c) => ({ col: hx + footprintCellDx(hy, c), row: hy + c.dy })) });
  }
  return plots;
}

/** One building's walk-blocked body: its footprint `blocked` cells on the map minus its door cell, or null
 *  when the type blocks nothing. A displacement search may cross this body but no other blocked cell. */
export function walkBlockedBodyOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  building: Entity,
): Set<NodeId> | null {
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return null;
  const footprint = buildingFootprintOf(ctx.content, b.buildingType);
  if (footprint === undefined || footprint.blocked.length === 0) return null;
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const body = new Set<NodeId>(translatedCells(terrain, footprint.blocked, ax, ay));
  const door = footprint.door;
  if (door !== undefined) {
    const doorX = ax + footprintCellDx(ay, door);
    if (terrain.inBounds(doorX, ay + door.dy)) body.delete(terrain.nodeAt(doorX, ay + door.dy));
  }
  return body.size === 0 ? null : body;
}

/** The two shared walk-block caches - building bodies then resource footprints - as a layer list a caller
 *  folds into its own {@link LayeredBlocks}. The sets are the live cached copies: membership reads only. */
export function dynamicBlockLayers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
): readonly [ReadonlySet<NodeId>, ReadonlySet<NodeId>] {
  return [buildingBlockedCells(world, ctx, terrain), resourceBlockedCells(world, terrain)];
}

/** The building and resource walk-block overlay as a membership view over the cached layers, copying
 *  neither, so composing it is O(1) per call. */
export function dynamicBlockOverlay(world: World, ctx: SystemContext, terrain: TerrainGraph): BlockOverlay {
  return new LayeredBlocks(dynamicBlockLayers(world, ctx, terrain));
}
