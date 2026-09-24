import {
  chatHoldsSettler,
  Engagement,
  FamilyDuty,
  Fleeing,
  PlayerOrder,
  Wedding,
} from '../../components/index.js';
import type { Component, Entity, World } from '../../ecs/world.js';

/** The markers whose presence hands a settler to another system; a company chat counts as well. */
export const ACTION_OWNER_MARKERS: readonly Component<unknown>[] = [
  Engagement,
  Fleeing,
  PlayerOrder,
  Wedding,
  FamilyDuty,
];

/**
 * Whether a system outside the planner currently owns `e`'s actions, so the economy ladder must not
 * re-task it. Each marker's owner clears it when its episode ends.
 *
 * The DEFEND-stance hold is deliberately not here: it lives in the drive ladder instead.
 */
export function anotherSystemOwns(world: World, e: Entity): boolean {
  for (const marker of ACTION_OWNER_MARKERS) if (world.has(e, marker)) return true;
  return chatHoldsSettler(world, e);
}
