import { type ContentSet, footprintCellDx } from '@open-northland/data';
import {
  Building,
  GroundDrop,
  Palisade,
  Position,
  ResourceFootprint,
  RoadSite,
  Stockpile,
} from '../../components/index.js';
import { landscapeTopologyRevision } from '../../components/landscape.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, MapContext, SystemContext } from '../context.js';
import { closer, nearestCell } from '../spatial/metric.js';
import { buildingBlockedCells } from './building-blocked-cache.js';
import { ANCHOR_ONLY, buildingFootprintOf } from './geometry.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';
import { resourceAtTile } from './resource-tile-cache.js';
import { type RouteRegions, routeRegions } from './route-regions.js';

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
  return resolveInteractionNode(world, ctx, building) ? { x: resolvedX, y: resolvedY } : null;
}

/** {@link interactionNode} clamped onto `terrain` as a node id, allocating nothing: the form for a per-candidate
 *  scan. Null where {@link interactionNode} is. */
export function interactionCellOf(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  building: Entity,
): NodeId | null {
  return resolveInteractionNode(world, ctx, building) ? terrain.nodeAtClamped(resolvedX, resolvedY) : null;
}

/** Whether half-cell node `(x, y)` is the building's {@link interactionNode}, false where that is null.
 *  Allocates nothing, for a per-settler presence test. */
export function atInteractionNode(
  world: World,
  ctx: MapContext,
  building: Entity,
  x: number,
  y: number,
): boolean {
  return resolveInteractionNode(world, ctx, building) && resolvedX === x && resolvedY === y;
}

/** The node {@link resolveInteractionNode} found, read straight after a call that answered true. */
let resolvedX = 0;
let resolvedY = 0;

function resolveInteractionNode(world: World, ctx: MapContext, building: Entity): boolean {
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return false;
  const ax = nodeHxOfPosition(p.x, p.y);
  const ay = nodeHyOfPosition(p.y);
  resolvedX = ax;
  resolvedY = ay;
  const door = buildingFootprintOf(ctx.content, b.buildingType, b.tribe)?.door;
  if (door === undefined) return true;
  const x = ax + footprintCellDx(ay, door);
  const y = ay + door.dy;
  if (ctx.terrain !== undefined && !ctx.terrain.inBounds(x, y)) return true;
  resolvedX = x;
  resolvedY = y;
  return true;
}

/** {@link interactionNode} as a terrain {@link NodeId}. Null for an unpositioned building or an off-map
 *  node - the in-bounds fallback covers a terrain passed via `ctx`; this guards a caller's own graph. */
export function interactionNodeId(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  building: Entity,
): NodeId | null {
  if (!resolveInteractionNode(world, ctx, building) || !terrain.inBounds(resolvedX, resolvedY)) return null;
  return terrain.nodeAt(resolvedX, resolvedY);
}

/**
 * Walkable, dynamically unblocked nodes immediately outside a construction site's current body, ascending.
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
  const palisade = world.tryGet(site, Palisade);
  const position = world.tryGet(site, Position);
  const road = world.has(site, RoadSite);
  if ((building === undefined && palisade === undefined && !road) || position === undefined) return [];

  const ax = nodeHxOfPosition(position.x, position.y);
  const ay = nodeHyOfPosition(position.y);
  const footprint =
    building === undefined
      ? undefined
      : buildingFootprintOf(ctx.content, building.buildingType, building.tribe);
  const bodyOffsets =
    palisade !== undefined && palisade.walk.length > 0
      ? palisade.walk
      : footprint !== undefined && footprint.blocked.length > 0
        ? footprint.blocked
        : ANCHOR_ONLY;
  bodyScratch.clear();
  for (let i = 0; i < bodyOffsets.length; i++) {
    const c = bodyOffsets[i];
    if (c === undefined) continue;
    const x = ax + footprintCellDx(ay, c);
    const y = ay + c.dy;
    if (terrain.inBounds(x, y)) bodyScratch.push(terrain.nodeAt(x, y));
  }
  if (bodyScratch.length === 0) bodyScratch.push(terrain.nodeAtClamped(ax, ay));
  workScratch.clear();
  if (exteriorScan.frame(terrain, bodyScratch)) {
    exteriorScan.flood(terrain, blocked);
    exteriorScan.collectWork(terrain, bodyScratch, workScratch);
  }
  return workScratch.copy();
}

/** The 4-connected neighbour offsets of `TerrainGraph.walkableNeighbours`, walked without its array. */
const NEIGHBOUR_DX: readonly number[] = [0, 1, 0, -1];
const NEIGHBOUR_DY: readonly number[] = [-1, 0, 1, 0];

/** The node at `(x, y)` when it is on the map and walkable, else null. */
function walkableAt(terrain: TerrainGraph, x: number, y: number): NodeId | null {
  if (!terrain.inBounds(x, y)) return null;
  const node = terrain.nodeAt(x, y);
  return terrain.isWalkable(node) ? node : null;
}

/** The largest box, margin included, the exterior flood scans, in nodes. The largest extracted body's
 *  box is 1102 nodes (the Artemis temple); an open gate's two posts make the sparsest real body. The cap
 *  only keeps a malformed hand-authored footprint from flooding the map. */
const MAX_EXTERIOR_SCAN_AREA = 2048;

/** {@link ExteriorScan} box marks. */
const BODY_MARK = 1;
const EXTERIOR_MARK = 2;
const WORK_MARK = 4;

/**
 * The walkable cells connected to the outside of a body's one-node bounding margin, flooded over marks
 * on that box that every call reuses. The bounded flood excludes enclosed footprint holes without scanning
 * the map, and a dynamic block cannot turn a sealed pocket into a work slot. A body whose box exceeds
 * {@link MAX_EXTERIOR_SCAN_AREA} yields no slots at all.
 */
class ExteriorScan {
  /** Row-major over the box from `(minX, minY)`. */
  private readonly marks = new Uint8Array(MAX_EXTERIOR_SCAN_AREA);
  private readonly frontier = new Int32Array(MAX_EXTERIOR_SCAN_AREA);
  private frontierLength = 0;
  private bodyMinX = 0;
  private bodyMaxX = 0;
  private bodyMinY = 0;
  private bodyMaxY = 0;
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;

  /** Frame `body`'s box and mark its cells; false when the box is over the cap. */
  frame(terrain: TerrainGraph, body: CellScratch): boolean {
    this.bodyMinX = terrain.width;
    this.bodyMaxX = 0;
    this.bodyMinY = terrain.height;
    this.bodyMaxY = 0;
    for (let i = 0; i < body.length; i++) {
      const cell = body.at(i);
      if (cell === undefined) continue;
      const x = terrain.xOf(cell);
      const y = terrain.yOf(cell);
      this.bodyMinX = Math.min(this.bodyMinX, x);
      this.bodyMaxX = Math.max(this.bodyMaxX, x);
      this.bodyMinY = Math.min(this.bodyMinY, y);
      this.bodyMaxY = Math.max(this.bodyMaxY, y);
    }
    this.minX = Math.max(0, this.bodyMinX - 1);
    this.maxX = Math.min(terrain.width - 1, this.bodyMaxX + 1);
    this.minY = Math.max(0, this.bodyMinY - 1);
    this.maxY = Math.min(terrain.height - 1, this.bodyMaxY + 1);
    const area = (this.maxX - this.minX + 1) * (this.maxY - this.minY + 1);
    if (area > MAX_EXTERIOR_SCAN_AREA) return false;
    this.marks.fill(0, 0, area);
    for (let i = 0; i < body.length; i++) {
      const cell = body.at(i);
      if (cell !== undefined) this.marks[this.boxIndex(terrain.xOf(cell), terrain.yOf(cell))] = BODY_MARK;
    }
    return true;
  }

  /** Mark the exterior, seeded from the margin rows and columns the map edge leaves open. */
  flood(terrain: TerrainGraph, blocked: BlockOverlay): void {
    const { minX, maxX, minY, maxY } = this;
    this.frontierLength = 0;
    if (this.bodyMinY > 0) for (let x = minX; x <= maxX; x++) this.reach(terrain, blocked, x, minY);
    if (this.bodyMaxY < terrain.height - 1)
      for (let x = minX; x <= maxX; x++) this.reach(terrain, blocked, x, maxY);
    if (this.bodyMinX > 0) for (let y = minY; y <= maxY; y++) this.reach(terrain, blocked, minX, y);
    if (this.bodyMaxX < terrain.width - 1)
      for (let y = minY; y <= maxY; y++) this.reach(terrain, blocked, maxX, y);
    for (let index = 0; index < this.frontierLength; index++) {
      const cell = this.frontier[index] as NodeId;
      const cx = terrain.xOf(cell);
      const cy = terrain.yOf(cell);
      for (let n = 0; n < NEIGHBOUR_DX.length; n++) {
        const x = cx + (NEIGHBOUR_DX[n] ?? 0);
        const y = cy + (NEIGHBOUR_DY[n] ?? 0);
        if (this.inBox(x, y)) this.reach(terrain, blocked, x, y);
      }
    }
  }

  /** Push the exterior cells 4-adjacent to `body` into `out`, ascending node id. */
  collectWork(terrain: TerrainGraph, body: CellScratch, out: CellScratch): void {
    for (let i = 0; i < body.length; i++) {
      const cell = body.at(i);
      if (cell === undefined) continue;
      const x = terrain.xOf(cell);
      const y = terrain.yOf(cell);
      for (let n = 0; n < NEIGHBOUR_DX.length; n++) {
        const nx = x + (NEIGHBOUR_DX[n] ?? 0);
        const ny = y + (NEIGHBOUR_DY[n] ?? 0);
        if (!this.inBox(nx, ny)) continue;
        const index = this.boxIndex(nx, ny);
        const mark = this.marks[index] ?? 0;
        if ((mark & EXTERIOR_MARK) !== 0) this.marks[index] = mark | WORK_MARK;
      }
    }
    // The box is row-major like node ids, so a row scan lists the work cells ascending.
    for (let y = this.minY; y <= this.maxY; y++) {
      for (let x = this.minX; x <= this.maxX; x++) {
        if (((this.marks[this.boxIndex(x, y)] ?? 0) & WORK_MARK) !== 0) out.push(terrain.nodeAt(x, y));
      }
    }
  }

  /** Mark the in-box cell `(x, y)` exterior and queue it, unless it is body, already exterior, blocked or
   *  unwalkable. */
  private reach(terrain: TerrainGraph, blocked: BlockOverlay, x: number, y: number): void {
    const index = this.boxIndex(x, y);
    if (this.marks[index] !== 0) return;
    const cell = terrain.nodeAt(x, y);
    if (blocked.has(cell) || !terrain.isWalkable(cell)) return;
    this.marks[index] = EXTERIOR_MARK;
    this.frontier[this.frontierLength++] = cell;
  }

  private inBox(x: number, y: number): boolean {
    return x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY;
  }

  private boxIndex(x: number, y: number): number {
    return (y - this.minY) * (this.maxX - this.minX + 1) + (x - this.minX);
  }
}

/** A reusable cell list whose first {@link length} entries are live. It is cut by count, never by
 *  `length = 0`, which releases an array's backing store and makes the next write reallocate. */
class CellScratch {
  private readonly cells: NodeId[] = [];
  length = 0;

  clear(): void {
    this.length = 0;
  }

  push(cell: NodeId): void {
    this.cells[this.length++] = cell;
  }

  includes(cell: NodeId): boolean {
    for (let i = 0; i < this.length; i++) if (this.cells[i] === cell) return true;
    return false;
  }

  at(i: number): NodeId | undefined {
    return i < this.length ? this.cells[i] : undefined;
  }

  /** Overwrite live entry `i`. */
  set(i: number, cell: NodeId): void {
    this.cells[i] = cell;
  }

  /** Whether the live cells are exactly `list`, in order. */
  matches(list: readonly NodeId[]): boolean {
    if (list.length !== this.length) return false;
    for (let i = 0; i < this.length; i++) if (this.cells[i] !== list[i]) return false;
    return true;
  }

  copy(): NodeId[] {
    return this.cells.slice(0, this.length);
  }
}

const bodyScratch = new CellScratch();
const workScratch = new CellScratch();
const exteriorScan = new ExteriorScan();

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
  let good: number | null = null;
  // The minimum positive good is independent of the stockpile's insertion order.
  stock.amounts.forEach((amount, goodType) => {
    if (amount > 0 && (good === null || goodType < good)) good = goodType;
  });
  return good;
}

/**
 * Every cell {@link resourceWorkCell} could pick as this resource's work stance, over ALL possible `from`
 * positions - the pool, with the nearest pick left to the caller. A cell qualifies only where a unit can
 * stand under the structure overlay (buildings, resources, landscapes), so the pool is empty for a node
 * those structures wall in whole.
 *
 * A walkable deposit whose work area lists its own anchor is worked standing ON the deposit, as observed
 * of the original's clay digger. That anchor listing comes from the sandbox's invented work areas, NOT the
 * real clay records: those list the anchor only in their partial states, and the sim collapses `workAreas`
 * to the FULL state (`fullStateBlockAreaCells`), whose rows exclude `(0,0)`, so real records feeding this
 * would silently revert the digger to an adjacent stance. A blocking node's anchor never survives the
 * standable filter, so trees, stones and ore keep the adjacent stance.
 */
function fillResourceStanceCells(
  world: World,
  terrain: TerrainGraph,
  regions: RouteRegions,
  resource: Entity,
  out: CellScratch,
): void {
  fillResourceApproachCells(world, terrain, resource, out);
  keepStandable(regions, out);
}

/** Resource approaches before buildings and landscapes cover them, for selected-work diagnostics. */
export function resourceApproachCells(
  world: World,
  terrain: TerrainGraph,
  resource: Entity,
): readonly NodeId[] {
  const out = new CellScratch();
  fillResourceApproachCells(world, terrain, resource, out);
  return out.copy();
}

/** {@link resourceApproachCells} written into `out`, which is emptied first. */
function fillResourceApproachCells(
  world: World,
  terrain: TerrainGraph,
  resource: Entity,
  out: CellScratch,
): void {
  out.clear();
  const p = world.get(resource, Position);
  const ax = nodeHxOfPosition(p.x, p.y);
  const ay = nodeHyOfPosition(p.y);
  const anchor = terrain.nodeAtClamped(ax, ay);
  const cells = world.get(resource, ResourceFootprint).work;
  const resources = resourceBlockedCells(world, terrain);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c === undefined) continue;
    const x = ax + footprintCellDx(ay, c);
    const y = ay + c.dy;
    if (!terrain.inBounds(x, y)) continue;
    const cell = terrain.nodeAt(x, y);
    if (terrain.isWalkable(cell) && !resources.has(cell)) out.push(cell);
  }
  if (out.includes(anchor)) {
    out.clear();
    out.push(anchor);
  } else if (out.length === 0) {
    pushFreeNeighbours(terrain, anchor, resources, out);
  }
}

/** Push `anchor`'s walkable 4-neighbours outside `resources`, in `TerrainGraph.walkableNeighbours` order. */
function pushFreeNeighbours(
  terrain: TerrainGraph,
  anchor: NodeId,
  resources: ReadonlySet<NodeId>,
  out: CellScratch,
): void {
  const x = terrain.xOf(anchor);
  const y = terrain.yOf(anchor);
  for (let n = 0; n < NEIGHBOUR_DX.length; n++) {
    const cell = walkableAt(terrain, x + (NEIGHBOUR_DX[n] ?? 0), y + (NEIGHBOUR_DY[n] ?? 0));
    if (cell !== null && !resources.has(cell)) out.push(cell);
  }
}

/** Drop from `cells`, in place, the ones a building or landscape covers. The pool itself is chosen against
 *  the resource layer alone, so a deposit a house buries keeps its covered anchor stance and ends up with
 *  none, instead of being worked from beside the house. */
function keepStandable(regions: RouteRegions, out: CellScratch): void {
  let kept = 0;
  for (let i = 0; i < out.length; i++) {
    const cell = out.at(i);
    if (cell !== undefined && regions.standable(cell)) out.set(kept++, cell);
  }
  out.length = kept;
}

/**
 * The `pool` member nearest `from`, node-id tie-break, skipping a cell sealed in a pocket `from` is not in.
 * Null when every member is sealed away. A pocketed `from` keeps the open cells, since a caller may pass a
 * stand-in node for the walker (a flag, a door), and without `from` no cell is judged.
 */
function nearestOpenStance(
  terrain: TerrainGraph,
  regions: RouteRegions,
  pool: readonly NodeId[],
  from: NodeId | undefined,
): NodeId | null {
  // `nearestCell`'s loop and tie-break, with the pocket veto inline rather than a closure per call. The
  // veto, which can flood, runs only for a cell that would beat the best so far.
  const fx = from === undefined ? 0 : terrain.xOf(from);
  const fy = from === undefined ? 0 : terrain.yOf(from);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pool.length; i++) {
    const cell = pool[i];
    if (cell === undefined) continue;
    const dist = from === undefined ? 0 : Math.abs(terrain.xOf(cell) - fx) + Math.abs(terrain.yOf(cell) - fy);
    if (!closer(dist, cell, bestDist, bestCell)) continue;
    if (from !== undefined && regions.pocketed(cell) && regions.unroutable(from, cell)) continue;
    best = cell;
    bestDist = dist;
    bestCell = cell;
  }
  return best;
}

/** The cell a collector stands on to work a resource: the {@link resourceStanceCells} pool member nearest
 *  `from` that a walk from there can enter. With none, the bare anchor, which a blocking node's own
 *  footprint blocks, so the pickers' overlay gate refuses it. */
export function resourceWorkCell(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  resource: Entity,
  from?: NodeId,
): NodeId {
  const pool = resourceStanceCells(world, ctx, terrain, resource);
  const cell = nearestOpenStance(terrain, stancePools(world, ctx, terrain).regions, pool, from);
  if (cell !== null) return cell;
  const p = world.get(resource, Position);
  return terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
}

/**
 * Every cell {@link positionedInteractionCell} could pick for a plain positioned target, over all `from`
 * positions. Empty when no unit can stand on or beside it, such as a pile left on an exhausted deposit's
 * cell that neighbouring stones still cover.
 */
export function positionedStanceCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  entity: Entity,
): readonly NodeId[] {
  const p = world.get(entity, Position);
  const x = nodeHxOfPosition(p.x, p.y);
  const y = nodeHyOfPosition(p.y);
  const resource = resourceUnderDrop(world, entity, x, y);
  if (resource !== null) return resourceStanceCells(world, ctx, terrain, resource);
  return anchoredStanceCells(world, ctx, terrain, terrain.nodeAtClamped(x, y));
}

/** {@link positionedStanceCells} for a target on `anchor` that is no ground drop under a standing
 *  resource. */
export function anchoredStanceCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  anchor: NodeId,
): readonly NodeId[] {
  const pools = stancePools(world, ctx, terrain);
  const held = pools.anchored.get(anchor);
  if (held?.epoch === pools.epoch) return held.cells;
  fillAnchoredStanceCells(world, terrain, pools.regions, anchor, scratchCells);
  const cells = keptOrCopied(held?.cells, scratchCells);
  if (held === undefined) pools.anchored.set(anchor, { epoch: pools.epoch, cells });
  else {
    held.epoch = pools.epoch;
    held.cells = cells;
  }
  return cells;
}

/** The structure overlay revision the stance pools are derived under: while it holds, so does every
 *  {@link anchoredStanceCells} answer. */
export function stanceOverlayEpoch(world: World, ctx: ContentContext, terrain: TerrainGraph): number {
  return stancePools(world, ctx, terrain).epoch;
}

/** A plain target's stance pool, a function of its anchor and the structure overlay alone: the anchor
 *  when a unit can stand there, else the standable neighbours a resource leaves free. */
function fillAnchoredStanceCells(
  world: World,
  terrain: TerrainGraph,
  regions: RouteRegions,
  anchor: NodeId,
  out: CellScratch,
): void {
  out.clear();
  const resources = resourceBlockedCells(world, terrain);
  if (resources.has(anchor)) pushFreeNeighbours(terrain, anchor, resources, out);
  else out.push(anchor);
  keepStandable(regions, out);
}

/** The scratch every pool derivation writes into before {@link keptOrCopied} settles what to hand out. */
const scratchCells = new CellScratch();

/** `held` when it lists exactly `fresh`, else a copy of `fresh`, so an unchanged pool keeps its array
 *  across a structure change and only a changed one allocates. */
function keptOrCopied(held: readonly NodeId[] | undefined, fresh: CellScratch): readonly NodeId[] {
  if (held !== undefined && fresh.matches(held)) return held;
  return fresh.length === 0 ? NO_STANCES : fresh.copy();
}

/** The standing resource a ground drop at node `(x, y)` lies under and is collected from, or null. */
function resourceUnderDrop(world: World, entity: Entity, x: number, y: number): Entity | null {
  const drop = world.tryGet(entity, GroundDrop);
  if (drop === undefined) return null;
  return resourceAtTile(world, x, y, stockedGoodAt(world, entity) ?? drop.goodType);
}

/** The pool of a target no unit can stand on or beside, shared since every caller only reads it. */
const NO_STANCES: readonly NodeId[] = [];

/**
 * The interaction cell for a plain positioned target: its anchor when a unit can stand there, else the
 * nearest cell beside it. A loose ground drop under a still-standing resource is collected from that
 * resource's work cell, which keeps mined goods on the intended cadence: one chip drops one ore or clay at
 * the deposit, then the collector picks it up before starting another chip. Blocking deposits get the
 * adjacent stance because their anchor is unwalkable; low non-blocking deposits (clay) still use the same
 * work-cell rule so they are not mined dry before the first pickup. With no enterable cell, the anchor.
 */
export function positionedInteractionCell(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  entity: Entity,
  from?: NodeId,
): NodeId {
  const p = world.get(entity, Position);
  const anchor = terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
  const pool = positionedStanceCells(world, ctx, terrain, entity);
  return nearestOpenStance(terrain, stancePools(world, ctx, terrain).regions, pool, from) ?? anchor;
}

interface StancePoolEntry {
  epoch: number;
  position: number | undefined;
  footprint: number | undefined;
  cells: readonly NodeId[];
}
interface StancePools {
  validatedAt: number;
  epoch: number;
  readonly terrain: TerrainGraph;
  readonly content: ContentSet;
  buildings: ReadonlySet<NodeId>;
  resources: number;
  landscape: number;
  readonly removed: ChangeFeed;
  readonly resource: Map<Entity, StancePoolEntry>;
  /** {@link fillAnchoredStanceCells} by anchor node, each valid while its epoch is current. */
  readonly anchored: Map<NodeId, AnchoredPoolEntry>;
  /** The route-region verdicts of the current epoch, whose inputs are the epoch's own. */
  regions: RouteRegions;
}
interface AnchoredPoolEntry {
  epoch: number;
  cells: readonly NodeId[];
}
const stancePoolsByWorld = new WeakMap<World, StancePools>();

/** Anchored pools kept across structure changes before they are dropped wholesale, so the nodes piles
 *  once lay on cannot accumulate without bound. A memory bound only: a dropped pool is re-derived. */
const MAX_HELD_ANCHORED_POOLS = 8192;

function stancePools(world: World, ctx: ContentContext, terrain: TerrainGraph): StancePools {
  let pools = stancePoolsByWorld.get(world);
  if (
    pools !== undefined &&
    pools.terrain === terrain &&
    pools.content === ctx.content &&
    pools.validatedAt === world.mutationVersion
  )
    return pools;
  const buildings = buildingBlockedCells(world, ctx, terrain);
  const resources = world.componentGeneration(ResourceFootprint);
  const landscape = landscapeTopologyRevision(world);
  if (pools === undefined || pools.terrain !== terrain || pools.content !== ctx.content) {
    const removed = pools?.removed ?? world.watchChanges([Position], []);
    pools = {
      validatedAt: world.mutationVersion,
      epoch: 0,
      terrain,
      content: ctx.content,
      buildings,
      resources,
      landscape,
      removed,
      resource: new Map(),
      anchored: new Map(),
      regions: routeRegions(world, ctx, terrain),
    };
    stancePoolsByWorld.set(world, pools);
    world.registerCacheVerifier('interactionStancePools', () => verifyStancePools(world, ctx, terrain));
  }
  if (pools.buildings !== buildings || pools.resources !== resources || pools.landscape !== landscape) {
    // Keep records for reuse; callers may still hold their previous cells arrays.
    if (pools.epoch === Number.MAX_SAFE_INTEGER) {
      pools.resource.clear();
      pools.anchored.clear();
      pools.epoch = 0;
    } else pools.epoch += 1;
    if (pools.anchored.size > MAX_HELD_ANCHORED_POOLS) pools.anchored.clear();
    pools.regions = routeRegions(world, ctx, terrain);
    pools.buildings = buildings;
    pools.resources = resources;
    pools.landscape = landscape;
  }
  pools.validatedAt = world.mutationVersion;
  if (pools.removed.pending) drainRemovedPositions(world, pools);
  return pools;
}

function drainRemovedPositions(world: World, pools: StancePools): void {
  const overflow = pools.removed.drain((entity) => {
    if (!world.has(entity, Position)) {
      pools.resource.delete(entity);
    }
  });
  if (overflow) {
    pools.resource.clear();
  }
}

/** Resource stance pools share only within an unchanged structure overlay. The nearest pick and
 * pocket veto still run for every origin. */
export function resourceStanceCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  resource: Entity,
): readonly NodeId[] {
  const pools = stancePools(world, ctx, terrain);
  const position = world.revisionOf(resource, Position);
  const footprint = world.revisionOf(resource, ResourceFootprint);
  const held = pools.resource.get(resource);
  if (
    held !== undefined &&
    held.epoch === pools.epoch &&
    held.position === position &&
    held.footprint === footprint
  )
    return held.cells;
  fillResourceStanceCells(world, terrain, pools.regions, resource, scratchCells);
  const cells = keptOrCopied(held?.cells, scratchCells);
  if (held === undefined) pools.resource.set(resource, { epoch: pools.epoch, position, footprint, cells });
  else {
    held.epoch = pools.epoch;
    held.position = position;
    held.footprint = footprint;
    held.cells = cells;
  }
  return cells;
}

function verifyStancePools(world: World, ctx: ContentContext, terrain: TerrainGraph): string[] {
  const pools = stancePoolsByWorld.get(world);
  if (
    pools === undefined ||
    pools.terrain !== terrain ||
    pools.content !== ctx.content ||
    pools.resources !== world.componentGeneration(ResourceFootprint) ||
    pools.landscape !== landscapeTopologyRevision(world) ||
    pools.buildings !== buildingBlockedCells(world, ctx, terrain)
  )
    return [];

  for (const [entity, held] of pools.resource) {
    if (
      held.epoch !== pools.epoch ||
      !world.has(entity, Position) ||
      held.position !== world.revisionOf(entity, Position) ||
      held.footprint !== world.revisionOf(entity, ResourceFootprint)
    )
      continue;
    const fresh = new CellScratch();
    fillResourceStanceCells(world, terrain, routeRegions(world, ctx, terrain), entity, fresh);
    if (!fresh.matches(held.cells)) return [`interaction stance pool differs for entity ${entity}`];
  }
  for (const [anchor, held] of pools.anchored) {
    if (held.epoch !== pools.epoch) continue;
    const fresh = new CellScratch();
    fillAnchoredStanceCells(world, terrain, routeRegions(world, ctx, terrain), anchor, fresh);
    if (!fresh.matches(held.cells)) return [`interaction stance pool differs for anchor ${anchor}`];
  }
  return [];
}
