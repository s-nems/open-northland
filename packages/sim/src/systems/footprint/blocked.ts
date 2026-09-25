import { type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Position, UnderConstruction } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type BlockOverlay, CountedBlocks } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { landscapeBlocks } from '../landscape/view.js';
import { buildingBlockedLayer } from './building-blocked-cache.js';
import { ANCHOR_ONLY, buildingFootprintOf, translatedCells } from './geometry.js';
import { resourceBlockedLayer } from './resource-blocked-cache.js';
import { vehicleBlockedLayer } from './vehicle-blocked-cache.js';

// Walk-block overlays for routing and render, over the memoized building cells and the incrementally
// cached resource cells. Derived state, never hashed. The views alias the live caches, so a holder must
// not span a stamp or unstamp.

/** Every standing building's door node - the passable gates the building walk-block carves out. */
export function buildingDoorNodes(world: World, ctx: ContentContext, terrain: TerrainGraph): Set<NodeId> {
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

/** The plots last derived for a world, with the generations they hold for. Of the Building fields only
 *  `buildingType` moves a plot, while `built` progress bumps the value generation on every construction
 *  advance, so a value bump replays the written buildings against {@link types} instead of rebuilding. */
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
    writesKeepSiteTypes(world, memo, buildingValueGeneration)
  ) {
    memo.buildingValueGeneration = buildingValueGeneration;
    return memo.plots;
  }
  world.journalValueWrites(Building);
  const types = new Map<Entity, number>();
  const plots: ConstructionPlot[] = [];
  for (const e of world.query(UnderConstruction, Building, Position)) {
    const b = world.get(e, Building);
    types.set(e, b.buildingType);
    const footprint = buildingFootprintOf(content, b.buildingType);
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const body = footprint !== undefined && footprint.blocked.length > 0 ? footprint.blocked : ANCHOR_ONLY;
    plots.push({ cells: body.map((c) => ({ col: hx + footprintCellDx(hy, c), row: hy + c.dy })) });
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

/** Whether the Building value writes since the memo's generation left every site's type alone. False
 *  when the journal cannot cover the span. */
function writesKeepSiteTypes(world: World, memo: ConstructionPlotMemo, valueGeneration: number): boolean {
  if (memo.buildingValueGeneration === valueGeneration) return true;
  const written = world.valueWritesSince(Building, memo.buildingValueGeneration);
  if (written === null) return false;
  for (const e of written) {
    const type = memo.types.get(e);
    if (type !== undefined && world.tryGet(e, Building)?.buildingType !== type) return false;
  }
  return true;
}

/** One building's walk-blocked body: its footprint `blocked` cells on the map minus its door cell, or null
 *  when the type blocks nothing. A displacement search may cross this body but no other blocked cell. */
export function walkBlockedBodyOf(
  world: World,
  ctx: ContentContext,
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

/** The dynamic walk-block overlay (buildings, resources, landscapes, vehicles) read through the layers'
 *  live per-node counts, so a membership test is array reads and composing it copies nothing. */
export function dynamicBlockOverlay(world: World, ctx: ContentContext, terrain: TerrainGraph): BlockOverlay {
  const landscape = landscapeBlocks(world, terrain);
  return new CountedBlocks([
    buildingBlockedLayer(world, ctx, terrain),
    resourceBlockedLayer(world, terrain),
    { cells: landscape.walk, counts: landscape.walkCounts },
    vehicleBlockedLayer(world, ctx, terrain),
  ]);
}
