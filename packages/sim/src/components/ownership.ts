import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The number of player slots the sim supports; player ids are the half-open range `[0, MAX_PLAYERS)`. A
 * player is who controls an entity, orthogonal to a settler/building/vehicle's `tribe`: two players can
 * both field vikings, and `tribe` alone cannot tell them apart. A revisable ceiling, not a fidelity
 * constant.
 */
export const MAX_PLAYERS = 16;

/** True when `player` is a valid player slot id - an integer in `[0, MAX_PLAYERS)`. */
export function isValidPlayer(player: number): boolean {
  return Number.isInteger(player) && player >= 0 && player < MAX_PLAYERS;
}

/**
 * Which player owns and controls this entity. Orthogonal to the `tribe` field those components carry -
 * `tribe` decides look, rules and tech; `Owner.player` decides who commands it, and so which units the app
 * lets the human player select and order. Only an entity spawned with a valid `owner` carries one, so a
 * neutral entity has none.
 */
export const Owner = defineComponent<{ player: number }>('Owner');

/** The owning player of `e`, or `undefined` for a neutral entity. */
export function ownerOf(world: World, e: Entity): number | undefined {
  return world.tryGet(e, Owner)?.player;
}

/**
 * Whether two entities are on the same side for the economy - a settler builds, staffs or supplies a
 * building only when this holds. Two players can both field the same `tribe`, so `tribe` alone cannot keep
 * their economies apart. Only a cross-player pairing is blocked, so a neutral entity stays compatible with
 * anyone.
 */
export function sameSide(world: World, a: Entity, b: Entity): boolean {
  return ownersCompatible(ownerOf(world, a), ownerOf(world, b));
}

/**
 * The {@link sameSide} rule on two owner ids directly, for the planner scans that already carry the
 * settler's owner as a number. Compatible unless both are explicit and differ.
 */
export function ownersCompatible(a: number | undefined, b: number | undefined): boolean {
  return a === undefined || b === undefined || a === b;
}

/**
 * {@link ownersCompatible} as a per-candidate predicate - the `onSide` gate the economy scans hand to their
 * shared nearest-candidate seams. A neutral scanner or a neutral candidate always passes.
 */
export function sameSideAs(world: World, owner: number | undefined): (e: Entity) => boolean {
  return (e) => ownersCompatible(owner, ownerOf(world, e));
}

/**
 * Stamp an {@link Owner} on `e` when `owner` is a valid player slot; an omitted or out-of-range `owner`
 * leaves the entity neutral. The single stamp point shared by every spawn handler, so an out-of-range owner
 * is a recoverable bad input rather than a throw.
 */
export function stampOwner(world: World, e: Entity, owner: number | undefined): void {
  if (owner !== undefined && isValidPlayer(owner)) world.add(e, Owner, { player: owner });
}
