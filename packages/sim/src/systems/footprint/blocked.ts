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
// cached resource cells. Derived state, never hashed, never stored. The views alias the live caches, so a
// holder spanning several entities relies on no stamp or unstamp running inside its schedule slot.

/**
 * Every standing building's door node, the passable gates {@link buildingBlockedCells} carves out of the
 * walk-block. A door is a designated stand, so displacement passes exempt it the same way the blocked-set
 * carve-out does.
 */
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
 *  `(col, row)` on the `2W×2H` half-cell lattice, the same coords `halfCellToScreen` projects. */
export interface ConstructionPlot {
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

/**
 * The ground plots of every under-construction building: its footprint body cells translated to world
 * half-cell nodes, so the render marks exactly the cells the finished building will stand on. A
 * footprint-less type falls back to its single anchor cell, so a site always marks its ground.
 */
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

/**
 * One building's walk-blocked body: its footprint `blocked` cells translated onto the map, minus its door
 * cell, or null when the type blocks nothing. A displacement search may cross this body's own cells but
 * never any other blocked cell.
 */
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

/** The two shared walk-block caches, standing building bodies then resource footprints, as a layer list a
 *  caller folds into its own {@link LayeredBlocks}. The sets stay the shared cached copies, so a caller
 *  must read membership only. */
export function dynamicBlockLayers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
): readonly [ReadonlySet<NodeId>, ReadonlySet<NodeId>] {
  return [buildingBlockedCells(world, ctx, terrain), resourceBlockedCells(world, terrain)];
}

/**
 * The building and resource walk-block overlay as a membership view that never copies either cached layer
 * into a fresh set, so a caller asking only `.has(node)` composes it in O(1) per call.
 */
export function dynamicBlockOverlay(world: World, ctx: SystemContext, terrain: TerrainGraph): BlockOverlay {
  return new LayeredBlocks(dynamicBlockLayers(world, ctx, terrain));
}
