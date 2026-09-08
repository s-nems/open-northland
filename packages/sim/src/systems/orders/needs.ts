import {
  CurrentAtomic,
  DeferredOrder,
  NeedOrder,
  NoRegeneration,
  Person,
  PlayerOrder,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { clearNavState } from '../movement/nav-state.js';
import { isOrderableSettler } from './guards.js';

/**
 * Send one owned settler to answer a need now - see the command doc. The stamp is all the order does: the
 * drive ladder reads {@link NeedOrder} as a pressing bar, and the atomic that answers the need clears it.
 * A need no rung can serve right now (no food in reach, no temple) leaves the order standing, so the
 * settler answers it as soon as one appears.
 */
export function orderNeed(world: World, command: Extract<Command, { kind: 'orderNeed' }>): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !world.has(e, Person)) return;
  world.add(e, NeedOrder, { need: command.need });
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // the need executing now supersedes any earlier parked order
  world.remove(e, PlayerOrder); // and any walk the settler was on
  clearNavState(world, e);
}

/** Allow or prohibit one owned settler's regeneration - see the command doc. */
export function setRegeneration(world: World, command: Extract<Command, { kind: 'setRegeneration' }>): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (command.enabled) world.remove(e, NoRegeneration);
  else world.add(e, NoRegeneration, { prohibited: true });
}
