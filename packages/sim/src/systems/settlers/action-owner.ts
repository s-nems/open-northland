import {
  chatHoldsSettler,
  Engagement,
  FamilyDuty,
  Fleeing,
  PlayerOrder,
  Rider,
  Wedding,
} from '../../components/index.js';
import type { Component, Entity, World } from '../../ecs/world.js';

/** The markers that hold a settler off the economy ladder; a company chat counts as well. */
const ECONOMY_HOLD_MARKERS: readonly Component<unknown>[] = [
  Engagement,
  Fleeing,
  PlayerOrder,
  Wedding,
  FamilyDuty,
];

/** The markers whose presence hands a settler to another system: a vehicle seat and the economy holds. */
export const ACTION_OWNER_MARKERS: readonly Component<unknown>[] = [Rider, ...ECONOMY_HOLD_MARKERS];

/**
 * Whether a system outside the planner currently owns `e`'s actions, so the economy ladder must not
 * re-task it. Each marker's owner clears it when its episode ends.
 *
 * The DEFEND-stance hold is deliberately not here: it lives in the drive ladder instead.
 */
export function anotherSystemOwns(world: World, e: Entity): boolean {
  return world.has(e, Rider) || heldOffEconomy(world, e);
}

/** {@link anotherSystemOwns} without the vehicle crew: a rider's own rung still runs under these. */
export function heldOffEconomy(world: World, e: Entity): boolean {
  for (const marker of ECONOMY_HOLD_MARKERS) if (world.has(e, marker)) return true;
  return chatHoldsSettler(world, e);
}
