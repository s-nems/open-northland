import { Age, Position, Sheltering } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { isInside } from '../settlers/indoors.js';
import { canonicalById } from '../spatial/nodes.js';

/**
 * The shelter `e` is manning: the defence-mode building it claimed and reached, rather than one it is still
 * running to. Manning is what the CombatSystem reads, so a manned settler never flees, never steps out to
 * chase, and is not a target itself, while a claimant still crossing the ground is an ordinary civilian.
 */
export function mannedShelter(world: World, e: Entity): Entity | null {
  const claim = world.tryGet(e, Sheltering);
  if (claim === undefined || !isInside(world, e, claim.shelter)) return null;
  // A claim outlives a razed building until the DefenceSystem sheds it, so reading a gone shelter as
  // unmanned keeps every reader that wants the building's Position off that ordering.
  return world.has(claim.shelter, Position) ? claim.shelter : null;
}

export function isManningShelter(world: World, e: Entity): boolean {
  return mannedShelter(world, e) !== null;
}

/** Every shooter's seat, its place `0..n-1` among the settlers manning one building, numbered in ascending
 *  id order so the same settler holds the same seat on every machine. Numbered over the arrived only:
 *  counting a claimant still crossing the field would leave the seats in play a sparse subset of `0..n-1`,
 *  which collides again under the spread's modulo. */
export function garrisonSeats(world: World): ReadonlyMap<Entity, number> {
  const seats = new Map<Entity, number>();
  const taken = new Map<Entity, number>();
  for (const e of canonicalById(world.query(Sheltering))) {
    const shelter = mannedShelter(world, e);
    if (shelter === null) continue;
    const seat = taken.get(shelter) ?? 0;
    taken.set(shelter, seat + 1);
    seats.set(e, seat);
  }
  return seats;
}

/**
 * Whether a manning settler draws the house bow: a grown civilian does, a baby or child hides without
 * fighting. Keyed on the {@link Age} marker rather than the age-class job ids because only a born-young
 * settler carries it, so a fixture's adult job id colliding with an age-class id cannot disarm an adult.
 */
export function drawsHouseBow(world: World, e: Entity): boolean {
  return !world.has(e, Age);
}
