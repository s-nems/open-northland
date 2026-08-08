import { footprintCellDx } from '@open-northland/data';
import {
  Building,
  GroundDrop,
  Position,
  ResourceFootprint,
  Stockpile,
  stockpileEntries,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../context.js';
import {
  ANCHOR_ONLY,
  buildingFootprintOf,
  nearestCell,
  nearestFreeNeighbour,
  translatedCells,
} from './geometry.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';
import { resourceAtTile } from './resource-tile-cache.js';

// INTERACTION - where a unit stands to use a building or resource: a building's door node, and the
// walkable work cell adjacent to (or on) a resource/ground drop.

/** An integer HALF-CELL NODE a unit stands on to interact with something - see {@link interactionNode}. */
export type InteractionNode = { readonly x: number; readonly y: number };

/**
 * The integer HALF-CELL NODE a settler must stand on to INTERACT with a building: its door node
 * (`anchor + footprint.door`, both half-cell offsets) when the type has one, else the anchor node, which
 * synthetic content keeps. The single seam every walk-to-the-building and at-the-building consumer
 * resolves through, so the walk goal and the presence test cannot disagree - with the walls blocking, the
 * anchor is typically unreachable and the door is where the original's settlers enter. An off-map door
 * falls back to the anchor node; only hand-authored content reaches that, since the placement rule forces
 * the whole reserved zone, door included, in-bounds. Null for an entity without a Building or Position.
 */
export function interactionNode(world: World, ctx: MapContext, building: Entity): InteractionNode | null {
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return null;
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const door = buildingFootprintOf(ctx.content, b.buildingType)?.door;
  if (door === undefined) return { x: ax, y: ay };
  const at = { x: ax + footprintCellDx(ay, door), y: ay + door.dy };
  if (ctx.terrain !== undefined && !ctx.terrain.inBounds(at.x, at.y)) return { x: ax, y: ay };
  return at;
}

/** {@link interactionNode} as a terrain {@link NodeId}. Null for an unpositioned building or an off-map
 *  node - the in-bounds fallback covers a terrain passed via `ctx`; this guards a caller's own graph. */
export function interactionNodeId(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  building: Entity,
): NodeId | null {
  const at = interactionNode(world, ctx, building);
  if (at === null || !terrain.inBounds(at.x, at.y)) return null;
  return terrain.nodeAt(at.x, at.y);
}

/**
 * Walkable, dynamically unblocked nodes immediately outside a construction site's current body.
 * Approximation until `LogicConstructionWorkArea` is extracted: the footprint perimeter, so settlers
 * approach any free side instead of queueing at the finished building's door.
 */
export function constructionWorkCells(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  site: Entity,
  blocked: BlockOverlay,
): readonly NodeId[] {
  const building = world.tryGet(site, Building);
  const position = world.tryGet(site, Position);
  if (building === undefined || position === undefined) return [];

  const anchorCoords = nodeOfPosition(position.x, position.y);
  const anchor = terrain.nodeAtClamped(anchorCoords.hx, anchorCoords.hy);
  const footprint = buildingFootprintOf(ctx.content, building.buildingType);
  const bodyOffsets =
    footprint !== undefined && footprint.blocked.length > 0 ? footprint.blocked : ANCHOR_ONLY;
  const bodyCells = translatedCells(terrain, bodyOffsets, anchorCoords.hx, anchorCoords.hy);
  if (bodyCells.length === 0) bodyCells.push(anchor);
  const body = new Set(bodyCells);
  const exterior = exteriorCellsAroundBody(terrain, bodyCells, body, blocked);
  const work = new Set<NodeId>();
  for (const cell of bodyCells) {
    for (const neighbour of terrain.walkableNeighbours(cell)) {
      if (exterior.has(neighbour)) work.add(neighbour);
    }
  }
  return [...work].sort((a, b) => a - b);
}

/** Current extracted footprints need at most 5 bounding-margin cells per body cell (handcart/oxcart).
 *  Eight leaves headroom while bounding malformed sparse synthetic footprints. */
const MAX_EXTERIOR_SCAN_CELLS_PER_BODY_CELL = 8;

/**
 * Walkable cells connected to the outside of a body's one-node bounding margin. The bounded flood excludes
 * enclosed footprint holes without scanning the map, and a dynamic block cannot turn a sealed pocket into
 * a work slot. A footprint outside the scan budget yields no slots at all.
 */
function exteriorCellsAroundBody(
  terrain: TerrainGraph,
  bodyCells: readonly NodeId[],
  body: ReadonlySet<NodeId>,
  blocked: BlockOverlay,
): ReadonlySet<NodeId> {
  let bodyMinX = terrain.width;
  let bodyMaxX = 0;
  let bodyMinY = terrain.height;
  let bodyMaxY = 0;
  for (const cell of bodyCells) {
    const { x, y } = terrain.coordsOf(cell);
    bodyMinX = Math.min(bodyMinX, x);
    bodyMaxX = Math.max(bodyMaxX, x);
    bodyMinY = Math.min(bodyMinY, y);
    bodyMaxY = Math.max(bodyMaxY, y);
  }
  const minX = Math.max(0, bodyMinX - 1);
  const maxX = Math.min(terrain.width - 1, bodyMaxX + 1);
  const minY = Math.max(0, bodyMinY - 1);
  const maxY = Math.min(terrain.height - 1, bodyMaxY + 1);
  const scanArea = (maxX - minX + 1) * (maxY - minY + 1);
  const scanBudget = Math.max(9, bodyCells.length * MAX_EXTERIOR_SCAN_CELLS_PER_BODY_CELL);
  if (scanArea > scanBudget) return new Set();
  const exterior = new Set<NodeId>();
  const frontier: NodeId[] = [];
  const seed = (x: number, y: number): void => {
    const cell = terrain.nodeAt(x, y);
    if (body.has(cell) || blocked.has(cell) || !terrain.isWalkable(cell) || exterior.has(cell)) return;
    exterior.add(cell);
    frontier.push(cell);
  };

  if (bodyMinY > 0) for (let x = minX; x <= maxX; x++) seed(x, minY);
  if (bodyMaxY < terrain.height - 1) for (let x = minX; x <= maxX; x++) seed(x, maxY);
  if (bodyMinX > 0) for (let y = minY; y <= maxY; y++) seed(minX, y);
  if (bodyMaxX < terrain.width - 1) for (let y = minY; y <= maxY; y++) seed(maxX, y);

  for (let index = 0; index < frontier.length; index++) {
    const cell = frontier[index];
    if (cell === undefined) break;
    for (const neighbour of terrain.walkableNeighbours(cell)) {
      const { x, y } = terrain.coordsOf(neighbour);
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (body.has(neighbour) || blocked.has(neighbour) || exterior.has(neighbour)) continue;
      exterior.add(neighbour);
      frontier.push(neighbour);
    }
  }
  return exterior;
}

/** The construction work cell nearest `from`, tie-broken by node id. */
export function constructionWorkCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  site: Entity,
  blocked: BlockOverlay,
  from?: NodeId,
): NodeId | null {
  return nearestCell(terrain, constructionWorkCells(world, ctx, terrain, site, blocked), from);
}

function stockedGoodAt(world: World, entity: Entity): number | null {
  const stock = world.tryGet(entity, Stockpile);
  if (stock === undefined) return null;
  for (const [goodType, amount] of stockpileEntries(stock)) {
    if (amount > 0) return goodType;
  }
  return null;
}

/**
 * Every cell {@link resourceWorkCell} could pick as this resource's work stance, over ALL possible `from`
 * positions - the pool, with the nearest pick left to the caller. Never empty: the last fallback is the
 * bare anchor.
 *
 * A walkable deposit whose work area lists its own anchor is worked standing ON the deposit, as observed
 * of the original's clay digger. That anchor listing comes from the sandbox's invented work areas, NOT the
 * real clay records: those list the anchor only in their partial states, and the sim collapses `workAreas`
 * to the FULL state (`fullStateBlockAreaCells`), whose rows exclude `(0,0)`, so real records feeding this
 * would silently revert the digger to an adjacent stance. A blocking node's anchor never survives the
 * walkable filter, so trees, stones and ore keep the adjacent stance.
 */
export function resourceStanceCells(
  world: World,
  terrain: TerrainGraph,
  resource: Entity,
): readonly NodeId[] {
  const p = world.get(resource, Position);
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const anchor = terrain.nodeAtClamped(ax, ay);
  const footprint = world.tryGet(resource, ResourceFootprint);
  if (footprint === undefined) return [anchor];

  const blocked = resourceBlockedCells(world, terrain);
  const work = translatedCells(terrain, footprint.work, ax, ay).filter(
    (cell) => terrain.isWalkable(cell) && !blocked.has(cell),
  );
  if (work.includes(anchor)) return [anchor];
  if (work.length > 0) return work;
  const fallback = terrain.walkableNeighbours(anchor).filter((cell) => !blocked.has(cell));
  return fallback.length > 0 ? fallback : [anchor];
}

/** The cell a collector stands on to work a resource: the {@link resourceStanceCells} pool member nearest
 *  `from`, node-id tie-break. The pool is never empty, so the anchor fallback is unreachable in practice. */
export function resourceWorkCell(
  world: World,
  terrain: TerrainGraph,
  resource: Entity,
  from?: NodeId,
): NodeId {
  const p = world.get(resource, Position);
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const anchor = terrain.nodeAtClamped(ax, ay);
  return nearestCell(terrain, resourceStanceCells(world, terrain, resource), from) ?? anchor;
}

/**
 * The interaction cell for a plain positioned target. A loose ground drop under a still-standing resource
 * is collected from that resource's work cell, which keeps mined goods on the intended cadence: one chip
 * drops one ore or clay at the deposit, then the collector picks it up before starting another chip.
 * Blocking deposits get the adjacent stance because their anchor is unwalkable; low non-blocking deposits
 * (clay) still use the same work-cell rule so they are not mined dry before the first pickup.
 */
export function positionedInteractionCell(
  world: World,
  terrain: TerrainGraph,
  entity: Entity,
  from?: NodeId,
): NodeId {
  const p = world.get(entity, Position);
  const { hx: x, hy: y } = nodeOfPosition(p.x, p.y);
  const anchor = terrain.nodeAtClamped(x, y);
  const drop = world.tryGet(entity, GroundDrop);
  if (drop !== undefined) {
    const resource = resourceAtTile(world, x, y, stockedGoodAt(world, entity) ?? drop.goodType);
    if (resource !== null) return resourceWorkCell(world, terrain, resource, from);
  }
  const blocked = resourceBlockedCells(world, terrain);
  if (!blocked.has(anchor)) return anchor;
  return nearestFreeNeighbour(terrain, anchor, blocked, from) ?? anchor;
}
