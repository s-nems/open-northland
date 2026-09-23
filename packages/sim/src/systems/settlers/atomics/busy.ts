import { CurrentAtomic, chatAtomicRunning, inPastimeChat, Wedding } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';

/**
 * Whether `e`'s running atomic owns it: a committed action no other system may cut short. A drive that may
 * take a settler off a work seat asks through here rather than reading the component.
 *
 * A craft clip normally owns nothing: it views the workplace's batch and the producer drive re-derives
 * it each tick. Once matched for a wedding, the worker stays at that batch until it finishes. Neither
 * does a pastime chat's talk or listen clip hold its participant.
 */
export function atomicHoldsSettler(world: World, e: Entity): boolean {
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic === undefined) return false;
  if (atomic.effect.kind === 'produce') return world.has(e, Wedding);
  return !(inPastimeChat(world, e) && chatAtomicRunning(world, e));
}
