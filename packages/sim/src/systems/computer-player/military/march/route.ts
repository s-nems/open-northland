import { Vehicle } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeManhattan } from '../../../../nav/halfcell.js';
import { findPath } from '../../../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { towardNode } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { dynamicBlockOverlay, vehicleAnchor } from '../../../footprint/index.js';
import { vehicleTraversal } from '../../../readviews/vehicles.js';
import { snapVehicleTarget, vehicleWalkBlocks } from '../../../vehicles/movement.js';
import { nodeOf } from './geometry.js';

// Where a wave gathers before it goes in. Every distance is an approximation: the original's army
// gathering is unobserved.

/** How far short of its objective (Manhattan half-cell nodes) the wave gathers: outside the enemy
 *  base around it. */
export const GATHER_STANDOFF_NODES = 40;

/** How far from an enemy tower (hex) the wave gathers: the house bow's extracted 29 hex reach, the longest
 *  a tower post shoots, and a few cells to spare. */
export const GATHER_TOWER_CLEARANCE_HEX = 36;

/** How far short of an enemy tower (Manhattan half-cell nodes) a raid band stops
 *  (`operations/raid-target.ts`): a catapult's longest reach and a few ranks behind it. */
export const SIEGE_TOWER_STANDOFF_NODES = 30;

/** The step of the straight line a wave walks when no path leads to its objective. */
const STRAIGHT_STEP_NODES = 12;

/**
 * The gathering point on the way from `start` to `objective`: the last node of the route before it comes
 * within {@link GATHER_STANDOFF_NODES} of the objective or {@link GATHER_TOWER_CLEARANCE_HEX} of one of
 * the enemy `towers`; null when `start` stands that near already, and the wave goes straight in. The route
 * is the lead catapult's own when it has one, so the catapults can stand there too, else a man's walk
 * around what blocks him, else the straight line. One path search per launch or retarget.
 */
export function gatheringPoint(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  start: NodeId,
  objective: NodeId,
  towers: readonly HalfCellNode[],
  lead: Entity | null,
): HalfCellNode | null {
  const goal = nodeOf(terrain, objective);
  const tooNear = (node: HalfCellNode): boolean =>
    nodeManhattan(node, goal) <= GATHER_STANDOFF_NODES ||
    towers.some((tower) => hexDistance(node, tower) <= GATHER_TOWER_CLEARANCE_HEX);
  const path =
    (lead === null ? null : catapultPath(world, ctx, terrain, lead, goal)) ??
    findPath(terrain, start, objective, dynamicBlockOverlay(world, ctx, terrain))?.map((n) =>
      nodeOf(terrain, n),
    ) ??
    straightLine(nodeOf(terrain, start), goal);
  let last: HalfCellNode | null = null;
  for (const node of path) {
    if (tooNear(node)) return last;
    last = node;
  }
  return last;
}

function catapultPath(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: HalfCellNode,
): HalfCellNode[] | null {
  const type = contentIndex(ctx.content).vehicles.get(world.get(vehicle, Vehicle).vehicleType);
  const anchor = vehicleAnchor(world, vehicle);
  if (type === undefined || anchor === null) return null;
  const snapped = snapVehicleTarget(world, ctx, terrain, vehicle, goal);
  if (snapped === null) return null;
  const blocks = vehicleWalkBlocks(world, ctx, terrain, vehicle, type);
  const from = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const path = findPath(terrain, from, snapped, blocks, undefined, vehicleTraversal(type));
  return path?.map((n) => nodeOf(terrain, n)) ?? null;
}

function straightLine(from: HalfCellNode, to: HalfCellNode): HalfCellNode[] {
  const line = [from];
  let at = from;
  while (at.hx !== to.hx || at.hy !== to.hy) {
    at = towardNode(at, to, STRAIGHT_STEP_NODES);
    line.push(at);
  }
  return line;
}
