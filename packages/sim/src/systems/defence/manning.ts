import { Position, Sheltering } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { isInside } from '../settlers/indoors.js';

/**
 * The shelter `e` is manning: the defence-mode building it claimed and reached, rather than one it is still
 * running to. A manned settler sits the fight out and is not a target itself, and its building fires for
 * it; a claimant still crossing the ground is an ordinary civilian.
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

/** How many settlers each defence-mode building holds right now: the arrived claimants only, since one
 *  still crossing the field adds nothing to the building's fire. Scales with the claims, not the map. */
export function shelterOccupancy(world: World): ReadonlyMap<Entity, number> {
  const occupancy = new Map<Entity, number>();
  for (const e of world.query(Sheltering)) {
    const shelter = mannedShelter(world, e);
    if (shelter !== null) occupancy.set(shelter, (occupancy.get(shelter) ?? 0) + 1);
  }
  return occupancy;
}
