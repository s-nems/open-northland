import { Vehicle } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import { findPath } from '../../../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { dynamicBlockOverlay, vehicleAnchor } from '../../../footprint/index.js';
import { vehicleTraversal } from '../../../readviews/vehicles.js';
import { snapVehicleTarget, vehicleWalkBlocks } from '../../../vehicles/movement.js';
import { towardNode } from '../../node-geometry.js';
import { manhattanOf, nodeOf } from './geometry.js';

// The route a wave marches, cut into legs. Every distance is an approximation.

/** How far one leg reaches along the route. Well inside one catapult hop. */
export const LEG_NODES = 12;

/** How far short of its objective the route ends: the wave closes up there before the siege. */
export const SIEGE_STANDOFF_NODES = 20;

/** How far short of such a tower the route ends: a catapult's longest reach and the ranks behind it, so
 *  the melee closes up out of the garrison's sight while the catapults drive in to fire. */
export const SIEGE_TOWER_STANDOFF_NODES = 30;

/**
 * The leg ends from `start` toward `objective`, {@link LEG_NODES} apart along the route and ending at the
 * first node within {@link SIEGE_STANDOFF_NODES} of it or {@link SIEGE_TOWER_STANDOFF_NODES} of one of its
 * `towers`; empty when `start` stands that near already. The route is the lead catapult's own when it has
 * one, else a man's walk around what blocks him, else the straight line.
 */
export function routeTo(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  start: NodeId,
  objective: NodeId,
  towers: readonly HalfCellNode[],
  lead: Entity | null,
): HalfCellNode[] {
  const goal = nodeOf(terrain, objective);
  const standsOff = (node: HalfCellNode): boolean =>
    manhattanOf(node, goal) <= SIEGE_STANDOFF_NODES ||
    towers.some((tower) => manhattanOf(node, tower) <= SIEGE_TOWER_STANDOFF_NODES);
  const path =
    (lead === null ? null : catapultPath(world, ctx, terrain, lead, goal)) ??
    findPath(terrain, start, objective, dynamicBlockOverlay(world, ctx, terrain))?.map((n) =>
      nodeOf(terrain, n),
    ) ??
    straightLine(nodeOf(terrain, start), goal);
  const ends: HalfCellNode[] = [];
  let last = path[0];
  if (last === undefined || standsOff(last)) return ends;
  for (const node of path) {
    if (standsOff(node)) {
      ends.push(node);
      return ends;
    }
    if (manhattanOf(node, last) < LEG_NODES) continue;
    ends.push(node);
    last = node;
  }
  ends.push(goal);
  return ends;
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
    at = towardNode(at, to, LEG_NODES);
    line.push(at);
  }
  return line;
}
