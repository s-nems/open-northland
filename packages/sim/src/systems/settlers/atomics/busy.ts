import { CurrentAtomic, chatAtomicRunning, inPastimeChat } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';

/**
 * Whether `e`'s running atomic owns it: a committed action no other system may cut short. A drive that may
 * take a settler off a work seat asks through here rather than reading the component.
 *
 * A craft clip owns nothing. It is a view of its workplace's batch, applies nothing on completion, and
 * the producer drive re-derives it every tick, so dropping it loses no state. Neither does a pastime
 * chat's talk or listen clip.
 */
export function atomicHoldsSettler(world: World, e: Entity): boolean {
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic === undefined || atomic.effect.kind === 'produce') return false;
  return !(inPastimeChat(world, e) && chatAtomicRunning(world, e));
}
