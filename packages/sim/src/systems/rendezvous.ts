import { MoveGoal, PathFollow, PathRequest, PathRoute, Position } from '../components/index.js';
import type { Fixed } from '../core/fixed.js';
import type { Component, DeepReadonly, Entity, World } from '../ecs/world.js';
import { type HalfCellNode, nodeOfPosition, nodesAdjacent, positionOfNode } from '../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../nav/terrain/index.js';
import { worldDistance } from '../nav/world-metric.js';
import type { SystemContext } from './context.js';
import { dynamicBlockOverlay, routeRegions } from './footprint/index.js';
import { clearNavState, isTravelling, liveStepEnd, stopAtNextNode } from './movement/nav-state.js';
import { routeStartCell } from './movement/route-start.js';
import { startAtomic } from './settlers/atomics/start.js';
import { stationaryOwnedSettlers } from './settlers/planner/spacing.js';

// The shared skeleton for "two settlers meet and perform a mirrored ritual": each half carries the ritual
// as a mirrored component, and the domain-specific bodies stay in their own systems.

/**
 * Drive every live mirrored pair of `component` once this tick, in canonical (ascending-id) order. A half
 * whose partner is dead or no longer points back is orphaned: torn down through `onOrphaned` instead of
 * driven against a vanished partner. An intact pair is advanced once, from the half `drives` selects.
 */
export function driveMirroredPairs<R extends { partner: Entity }>(
  world: World,
  component: Component<R>,
  drives: (self: Entity, partner: Entity, record: DeepReadonly<R>) => boolean,
  onOrphaned: (self: Entity) => void,
  drivePair: (a: Entity, b: Entity) => void,
): void {
  for (const e of world.canonicalQuery(component)) {
    const record = world.tryGet(e, component);
    if (record === undefined) continue; // cancelled earlier this pass from the partner's side
    const mirrored = world.isAlive(record.partner) ? world.tryGet(record.partner, component) : undefined;
    if (mirrored === undefined || mirrored.partner !== e) {
      onOrphaned(e);
      continue;
    }
    if (!drives(e, record.partner, record)) continue;
    drivePair(e, record.partner);
  }
}

/** Whether a pair on nodes `a` and `b` stands close enough for its paired action: on neighbouring nodes,
 *  never on one shared node, where the two sprites would draw as one settler. */
export function standsBeside(a: HalfCellNode, b: HalfCellNode): boolean {
  return nodesAdjacent(a, b) && (a.hx !== b.hx || a.hy !== b.hy);
}

/**
 * Halt `walker`, now beside its partner, at its next node, unless another settler stands there and its route
 * goes on: then it walks on toward the free node it was sent to. Returns whether it is still under way.
 */
export function haltBeside(world: World, terrain: TerrainGraph, walker: Entity): boolean {
  const halt = haltMidRoute(world, terrain, walker);
  if (
    halt !== undefined &&
    stationaryOwnedSettlers(world)
      .at(halt.hx, halt.hy)
      .some((e) => e !== walker)
  )
    return true;
  return stopAtNextNode(world, terrain, walker);
}

/** The node {@link stopAtNextNode} would halt `walker` on, when its route goes on past that node. */
function haltMidRoute(world: World, terrain: TerrainGraph, walker: Entity): HalfCellNode | undefined {
  const follow = world.tryGet(walker, PathFollow);
  const stops = world.tryGet(walker, PathRoute)?.waypoints;
  const p = world.tryGet(walker, Position);
  if (follow === undefined || stops === undefined || p === undefined) return undefined;
  const here = nodeOfPosition(p.x, p.y);
  const centre = positionOfNode(here.hx, here.hy);
  if (p.x === centre.x && p.y === centre.y) return follow.index < stops.length ? here : undefined;
  const end = liveStepEnd(terrain, follow.index, stops);
  if (end === undefined || end + 1 >= stops.length) return undefined;
  const stop = stops[end];
  return stop === undefined ? undefined : { hx: terrain.xOf(stop.node), hy: terrain.yOf(stop.node) };
}

/**
 * Close the distance for a pair not yet {@link standsBeside} each other: a failed route on either half
 * means the partner is unreachable, so halt both and `onUnreachable`; otherwise the awaited `b` halts and
 * the driving `a` walks to a node beside `target`, `b`'s node. No terrain (a mapless fixture) simply
 * waits, so such a pair acts only if it starts beside each other.
 */
export function approachPartner(
  world: World,
  ctx: SystemContext,
  a: Entity,
  b: Entity,
  target: { hx: number; hy: number },
  onUnreachable: () => void,
): void {
  const terrain = ctx.terrain;
  if (world.tryGet(a, PathRequest)?.failed === true || world.tryGet(b, PathRequest)?.failed === true) {
    if (terrain !== undefined) {
      stopAtNextNode(world, terrain, a);
      stopAtNextNode(world, terrain, b);
    } else {
      clearNavState(world, a);
      clearNavState(world, b);
    }
    onUnreachable();
    return;
  }
  if (terrain === undefined) return;
  if (stopAtNextNode(world, terrain, b) || isTravelling(world, a)) return;
  const position = world.get(a, Position);
  const from = routeStartCell(terrain, position.x, position.y);
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const regions = routeRegions(world, ctx, terrain);
  const standing = stationaryOwnedSettlers(world);
  // Walk beside the partner, never onto its node: the nearest such node no other settler stands on, else
  // the nearest at all. Equal picks keep the first node in scan order.
  let goal: NodeId | undefined;
  let goalTaken = false;
  let goalDistance: Fixed | undefined;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const hx = target.hx + dx;
      const hy = target.hy + dy;
      if ((dx === 0 && dy === 0) || !terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      if (
        !terrain.isWalkable(node) ||
        blocked.has(node) ||
        terrain.componentOf(from) !== terrain.componentOf(node) ||
        regions.unroutable(from, node)
      )
        continue;
      const taken = standing.at(hx, hy).length > 0;
      const centre = positionOfNode(hx, hy);
      const distance = worldDistance(position.x, position.y, centre.x, centre.y);
      if (
        goalDistance === undefined ||
        (goalTaken && !taken) ||
        (goalTaken === taken && distance < goalDistance)
      ) {
        goal = node;
        goalTaken = taken;
        goalDistance = distance;
      }
    }
  if (goal === undefined) {
    onUnreachable();
    return;
  }
  world.add(a, MoveGoal, { cell: goal });
}

/**
 * Halt both halves and start their paired atomics on one shared `duration` clock so they finish together,
 * each atomic targeting the other half so the render faces them.
 */
export function startPairedAtomics(
  world: World,
  a: Entity,
  aAtomic: number,
  b: Entity,
  bAtomic: number,
  duration: number,
): void {
  clearNavState(world, a);
  clearNavState(world, b);
  startAtomic(world, a, aAtomic, { kind: 'idle' }, duration, b);
  startAtomic(world, b, bAtomic, { kind: 'idle' }, duration, a);
}
