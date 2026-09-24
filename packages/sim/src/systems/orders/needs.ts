import {
  AttackOrder,
  CurrentAtomic,
  DeferredOrder,
  ExploreOrder,
  NeedOrder,
  NoRegeneration,
  Person,
  PlayerOrder,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { clearNavState } from '../movement/nav-state.js';
import { isHeroJob } from '../readviews/index.js';
import { isOrderableSettler } from './guards.js';

/**
 * Send one owned settler to answer a need now - see the command doc. The stamp is all the order does: the
 * drive ladder reads {@link NeedOrder} as a pressing bar, and the atomic that answers the need clears it.
 * A need no rung can serve right now (no food in reach, no temple) leaves the order standing, so the
 * settler answers it as soon as one appears.
 */
export function orderNeed(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'orderNeed' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !world.has(e, Person)) return;
  if (isHeroJob(ctx.content, world.get(e, Settler).jobType)) return;
  world.add(e, NeedOrder, { need: command.need });
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // the need executing now supersedes any earlier parked order
  world.remove(e, PlayerOrder); // and any walk the settler was on
  // And any standing attack order, which would otherwise pull the settler back into the fight the drive
  // ladder breaks off for the errand, leaving the order looking ignored.
  world.remove(e, AttackOrder);
  world.remove(e, ExploreOrder); // and a scout's sweep, whose next leg would walk the errand off
  clearNavState(world, e);
}

/** Allow or prohibit one owned settler's regeneration - see the command doc. */
export function setRegeneration(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setRegeneration' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (isHeroJob(ctx.content, world.get(e, Settler).jobType)) return;
  if (command.enabled) world.remove(e, NoRegeneration);
  else world.add(e, NoRegeneration, { prohibited: true });
}
