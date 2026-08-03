import { Age, Sheltering } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { isInside } from '../settlers/indoors.js';

/**
 * Whether `e` is MANNING its shelter - inside the defence-mode building it claimed, rather than still
 * running to it. Manning is what the CombatSystem reads: a manned settler never flees, never steps out
 * to chase, and is not a target itself (it is behind the walls). A claimant still crossing the ground is
 * an ordinary civilian - visible, killable, and fleeing.
 */
export function isManningShelter(world: World, e: Entity): boolean {
  const claim = world.tryGet(e, Sheltering);
  return claim !== undefined && isInside(world, e, claim.shelter);
}

/**
 * Whether a manning settler draws the house bow. A grown civilian does; a baby or child hides without
 * fighting, keeping the age classes out of combat as everywhere else. Keyed on the {@link Age} marker
 * rather than the age-class job ids for the reason the planner is (`lifecycle/ageclass.ts`): only a
 * born-young settler carries it, so a fixture's adult job id colliding with an age-class id cannot
 * silently disarm an adult.
 */
export function drawsHouseBow(world: World, e: Entity): boolean {
  return !world.has(e, Age);
}
