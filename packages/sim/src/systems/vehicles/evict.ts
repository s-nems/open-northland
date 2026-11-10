import type { VehicleType } from '@open-northland/data';
import { Position, Vehicle, VehicleDrive } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type HalfCellNode, positionOfNode } from '../../nav/halfcell.js';
import { hasOpenSide } from '../../nav/nearest.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingDoorwayNodes, dynamicBlockOverlay, walkBlockedBodyOf } from '../footprint/index.js';
import { vehicleBlockedCells } from '../footprint/vehicle-blocked-cache.js';
import { hexDisc, vehicleAnchor, vehicleFootprintNodes } from '../footprint/vehicle-footprint.js';
import { settlersByNode } from '../movement/settler-nodes.js';
import { vehicleTraversal } from '../readviews/vehicles.js';
import type { NodeBuckets } from '../spatial/nodes.js';
import { endDrive, startVehicleDrive, vehicleWalkBlocks } from './movement.js';
import { vehicleIndex } from './registry.js';

/** Project rule: placing or enlarging a house pushes overlapping vehicles and vehicles in newly sealed nooks onto free
 *  ground, just like settlers. The whole disc must fit; an enclosed vehicle with no landing stays put.
 *  Runs only when a footprint changes, never as a per-tick scan. */
export function evictVehiclesFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const body = walkBlockedBodyOf(world, ctx, terrain, building);
  if (body === null) return;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const doors = buildingDoorwayNodes(world, ctx, terrain);
  const evictees = vehicleIndex(world).all.filter((e) => {
    const cells = vehicleFootprintNodes(world, ctx.content, terrain, e);
    if (cells.some((node) => body.has(node))) return true;
    if (!cells.some((node) => terrain.neighbours(node).some((next) => body.has(next)))) return false;
    const anchor = vehicleAnchor(world, e);
    const type = contentIndex(ctx.content).vehicles.get(world.get(e, Vehicle).vehicleType);
    if (anchor === null || type === undefined || !terrain.inBounds(anchor.hx, anchor.hy)) return false;
    const from = terrain.nodeAt(anchor.hx, anchor.hy);
    if (doors.has(from)) return false;
    const traversal = vehicleTraversal(type);
    const walls = vehicleWalkBlocks(world, ctx, terrain, e, type);
    return !hasOpenSide(terrain, from, walls, traversal);
  });
  if (evictees.length === 0) return;
  const settlers = settlersByNode(world);
  // Own copy: each landing changes occupancy before the next vehicle chooses, in ascending entity id.
  const occupied = new Map(vehicleBlockedCells(world, ctx, terrain));
  const cover = (nodes: readonly NodeId[], delta: number): void => {
    for (const node of nodes) occupied.set(node, (occupied.get(node) ?? 0) + delta);
  };
  for (const e of evictees) {
    const state = world.get(e, Vehicle);
    const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
    const anchor = vehicleAnchor(world, e);
    if (type === undefined || anchor === null || !terrain.inBounds(anchor.hx, anchor.hy)) continue;
    const previous = vehicleFootprintNodes(world, ctx.content, terrain, e);
    cover(previous, -1);
    const landing = vehicleLanding(
      terrain,
      type,
      terrain.nodeAt(anchor.hx, anchor.hy),
      { blocked, doors, occupied, settlers },
      (node) => !blocked.has(node) || body.has(node),
    );
    if (landing === null) {
      cover(previous, 1);
      continue;
    }
    const goal = world.tryGet(e, VehicleDrive)?.goal;
    const next = { hx: terrain.xOf(landing), hy: terrain.yOf(landing) };
    const at = positionOfNode(next.hx, next.hy);
    const pos = world.mut(e, Position);
    pos.x = at.x;
    pos.y = at.y;
    // Vehicle writes invalidate the footprint caches, even for a parked cart whose task stays the same.
    const live = world.mut(e, Vehicle);
    live.guard = next;
    live.moored = false;
    if (live.task !== 'docks') live.mooring = null;
    endDrive(world, e); // discard a held boarding route too: its start moved
    if (goal !== undefined) {
      startVehicleDrive(world, ctx, terrain, e, terrain.nodeAtClamped(goal.hx, goal.hy));
    }
    cover(vehicleFootprintNodes(world, ctx.content, terrain, e), 1);
  }
}

/** What a vehicle's landing must keep clear of. */
interface LandingGround {
  readonly blocked: BlockOverlay;
  readonly doors: ReadonlySet<NodeId>;
  /** Nodes under other vehicles' discs, by how many cover each. */
  readonly occupied: ReadonlyMap<NodeId, number>;
  readonly settlers: NodeBuckets;
}

/** The nearest node, searched through `traverse`, where the type's whole disc stands on its own ground
 *  clear of `ground` and keeps an open side; null when none lies within the search cap. */
function vehicleLanding(
  terrain: TerrainGraph,
  type: VehicleType,
  from: NodeId,
  ground: LandingGround,
  traverse?: (node: NodeId) => boolean,
): NodeId | null {
  const traversal = vehicleTraversal(type);
  const accept = (node: NodeId): boolean => {
    const centre = { hx: terrain.xOf(node), hy: terrain.yOf(node) };
    for (const { hx, hy } of hexDisc(centre, type.logicSize)) {
      if (!terrain.inBounds(hx, hy)) return false;
      const cell = terrain.nodeAt(hx, hy);
      if (
        !terrain.traversable(cell, traversal) ||
        terrain.componentOf(cell) !== terrain.componentOf(node) ||
        ground.blocked.has(cell) ||
        ground.doors.has(cell) ||
        (ground.occupied.get(cell) ?? 0) > 0 ||
        ground.settlers.at(hx, hy).length > 0
      )
        return false;
    }
    return hasOpenSide(terrain, node, ground.blocked, traversal);
  };
  return ringSearch(
    terrain,
    from,
    STAND_SEARCH_CAP,
    traverse === undefined ? { accept } : { traverse, accept },
    traversal,
  );
}

/**
 * Where a vehicle a script stands for `anchor` lands: the anchor itself unless its disc covers a
 * walk-blocked node or a doorway, else the nearest landing clear of them, other vehicles and settlers,
 * else the anchor. Project rule, as for a settler spawned on a house body: a script names its point on
 * trust, and a house the player built there since would otherwise wall the vehicle in.
 */
export function vehicleSpawnAnchor(
  world: World,
  ctx: SystemContext,
  type: VehicleType,
  anchor: HalfCellNode,
): HalfCellNode {
  const terrain = ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(anchor.hx, anchor.hy)) return anchor;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const doors = buildingDoorwayNodes(world, ctx, terrain);
  const covered = hexDisc(anchor, type.logicSize).some(({ hx, hy }) => {
    if (!terrain.inBounds(hx, hy)) return false;
    const cell = terrain.nodeAt(hx, hy);
    return blocked.has(cell) || doors.has(cell);
  });
  if (!covered) return anchor;
  const occupied = vehicleBlockedCells(world, ctx, terrain);
  const landing = vehicleLanding(terrain, type, terrain.nodeAt(anchor.hx, anchor.hy), {
    blocked,
    doors,
    occupied,
    settlers: settlersByNode(world),
  });
  return landing === null ? anchor : { hx: terrain.xOf(landing), hy: terrain.yOf(landing) };
}
