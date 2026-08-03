import { Age, Sheltering } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { isInside } from '../settlers/indoors.js';
import { canonicalById } from '../spatial/nodes.js';

/**
 * The shelter `e` is MANNING - the defence-mode building it claimed AND has reached, rather than one it is
 * still running to - or null when it mans none. Manning is what the CombatSystem reads: a manned settler
 * never flees, never steps out to chase, and is not a target itself (it is behind the walls). A claimant
 * still crossing the ground is an ordinary civilian - visible, killable, and fleeing.
 */
export function mannedShelter(world: World, e: Entity): Entity | null {
  const claim = world.tryGet(e, Sheltering);
  if (claim === undefined || !isInside(world, e, claim.shelter)) return null;
  return claim.shelter;
}

export function isManningShelter(world: World, e: Entity): boolean {
  return mannedShelter(world, e) !== null;
}

/** Every claimant's SEAT - its place `0..n-1` in the garrison of the building it claimed, numbered in
 *  canonical (ascending-id) order so the same settler holds the same seat on every machine. Built once per
 *  combat tick rather than derived per shooter, which would cost a pass over the claims each time. */
export function garrisonSeats(world: World): ReadonlyMap<Entity, number> {
  const seats = new Map<Entity, number>();
  const taken = new Map<Entity, number>();
  for (const e of canonicalById(world.query(Sheltering))) {
    const shelter = world.get(e, Sheltering).shelter;
    const seat = taken.get(shelter) ?? 0;
    taken.set(shelter, seat + 1);
    seats.set(e, seat);
  }
  return seats;
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
