import { MoveGoal, PathRequest, Position } from '../components/index.js';
import type { Component, DeepReadonly, Entity, World } from '../ecs/world.js';
import type { SystemContext } from './context.js';
import { dynamicBlockOverlay, routeRegions } from './footprint/index.js';
import { clearNavState, isTravelling, stopAtNextNode } from './movement/nav-state.js';
import { routeStartCell } from './movement/route-start.js';
import { startAtomic } from './settlers/atomics/start.js';

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

/**
 * Close the distance for a pair standing apart: a failed route on either half means the partner is
 * unreachable, so halt both and `onUnreachable`; otherwise the awaited `b` halts and the driving `a`
 * walks to `target`. No terrain (a mapless fixture) simply waits, so such a pair acts only if it starts
 * adjacent.
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
  // Prefer the partner's centre, preserving ordinary meetings; a blocked centre can still be met
  // from one of the eight adjacent nodes under the same adjacency rule as the paired action.
  const candidates = [terrain.nodeAtClamped(target.hx, target.hy)];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (terrain.inBounds(target.hx + dx, target.hy + dy))
        candidates.push(terrain.nodeAt(target.hx + dx, target.hy + dy));
    }
  const goal = candidates.find(
    (node) =>
      terrain.isWalkable(node) &&
      !blocked.has(node) &&
      terrain.componentOf(from) === terrain.componentOf(node) &&
      !regions.unroutable(from, node),
  );
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
