import {
  chatHoldsSettler,
  Engagement,
  FamilyDuty,
  Fleeing,
  PlayerOrder,
  Wedding,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Whether a system outside the planner currently owns `e`'s actions, so the economy ladder must not
 * re-task it. Each marker's owner clears it when its episode ends.
 *
 * The DEFEND-stance hold is deliberately not here: it lives in the drive ladder instead.
 */
export function anotherSystemOwns(world: World, e: Entity): boolean {
  return (
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, PlayerOrder) ||
    world.has(e, Wedding) ||
    world.has(e, FamilyDuty) ||
    chatHoldsSettler(world, e)
  );
}
