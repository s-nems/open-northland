import { MoveGoal, PathRequest } from '../components/index.js';
import type { Component, Entity, World } from '../ecs/world.js';
import type { TerrainGraph } from '../nav/terrain/index.js';
import { startAtomic } from './agents/actions.js';
import { canonicalById, clearNavState, isTravelling } from './spatial.js';

// The shared skeleton for "two settlers meet and perform a mirrored ritual", used by the wedding pass
// (family/weddings.ts) and the gossip pass (social/gossip/drive.ts). Each half carries the ritual as a
// mirrored component; the domain-specific bodies (marriage vs chat rounds) stay in their own systems.

/**
 * Drive every live mirrored pair of `component` once this tick, in canonical (ascending-id) order. A half
 * whose partner is dead or no longer points back is orphaned: torn down through `onOrphaned` instead of
 * driven against a vanished partner. An intact pair is advanced once, from the half `drives` selects.
 */
export function driveMirroredPairs<R extends { partner: Entity }>(
  world: World,
  component: Component<R>,
  drives: (self: Entity, partner: Entity, record: R) => boolean,
  onOrphaned: (self: Entity) => void,
  drivePair: (a: Entity, b: Entity) => void,
): void {
  for (const e of canonicalById(world.query(component))) {
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
  terrain: TerrainGraph | undefined,
  a: Entity,
  b: Entity,
  target: { hx: number; hy: number },
  onUnreachable: () => void,
): void {
  if (world.tryGet(a, PathRequest)?.failed === true || world.tryGet(b, PathRequest)?.failed === true) {
    clearNavState(world, a);
    clearNavState(world, b);
    onUnreachable();
    return;
  }
  if (terrain === undefined) return;
  if (isTravelling(world, b)) clearNavState(world, b);
  if (!isTravelling(world, a)) world.add(a, MoveGoal, { cell: terrain.nodeAtClamped(target.hx, target.hy) });
}

/**
 * Halt both halves and start their paired atomics on one shared `duration` clock so they finish together,
 * each atomic targeting the other half so the render faces them. The wedding kiss and every gossip
 * talk/listen round begin this way.
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
