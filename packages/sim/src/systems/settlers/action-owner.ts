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

/** The markers whose owner walks a settler somewhere of its own, so a supply errand or pickup claim the
 *  economy stamped is stale under them; a company chat counts as well. Family duty is not among them: the
 *  child order plans its own fetch and releases the economy's errand when it takes the woman. */
const ERRAND_DIVERTING_MARKERS: readonly Component<unknown>[] = [Engagement, Fleeing, PlayerOrder, Wedding];

/** The markers that hold a settler off the economy ladder. */
const ECONOMY_HOLD_MARKERS: readonly Component<unknown>[] = [...ERRAND_DIVERTING_MARKERS, FamilyDuty];

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

/** Whether an owner that walks `e` elsewhere holds it, so an errand it carries is stale. A rider keeps
 *  its cargo errand and a woman on family duty the fetch the child order planned. */
export function divertsErrand(world: World, e: Entity): boolean {
  for (const marker of ERRAND_DIVERTING_MARKERS) if (world.has(e, marker)) return true;
  return chatHoldsSettler(world, e);
}
