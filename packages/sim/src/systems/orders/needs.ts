import {
  AttackOrder,
  CurrentAtomic,
  NeedOrder,
  NoRegeneration,
  Person,
  PlayerOrder,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { carriesNeeds } from '../lifecycle/needs/index.js';
import { clearNavState } from '../movement/nav-state.js';
import { isHeroJob } from '../readviews/index.js';
import { isOrderableSettler, supersedeStandingOrders } from './guards.js';

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
  // A settler whose bars do not move, a hero or a script-frozen unit, has no rung that would answer the
  // order and clear it.
  if (!carriesNeeds(world, ctx.content, e)) return;
  world.add(e, NeedOrder, { need: command.need });
  world.remove(e, CurrentAtomic);
  supersedeStandingOrders(world, e);
  world.remove(e, PlayerOrder); // and any walk the settler was on
  // And any standing attack order, which would otherwise pull the settler back into the fight the drive
  // ladder breaks off for the errand, leaving the order looking ignored.
  world.remove(e, AttackOrder);
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
