import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The number of player slots the sim supports; player ids are the half-open range `[0, MAX_PLAYERS)`.
 * Authored: a revisable ceiling, not a fidelity constant, but it stays below 32 so a per-player set
 * (`PlayerContacts`, `MatchRules`) fits one integer bitmask.
 */
export const MAX_PLAYERS = 16;

export function isValidPlayer(player: number): boolean {
  return Number.isInteger(player) && player >= 0 && player < MAX_PLAYERS;
}

/**
 * Which player owns and controls this entity, orthogonal to the `tribe` a settler, building or vehicle
 * carries: `tribe` decides look, rules and tech, and two players can both field vikings, so `tribe` alone
 * cannot tell them apart. An entity carrying no `Owner` is neutral.
 */
export const Owner = defineComponent<{ player: number }>('Owner', 'players');

export function ownerOf(world: World, e: Entity): number | undefined {
  return world.tryGet(e, Owner)?.player;
}

/** Whether two entities are on the same side - {@link ownersCompatible} on their owners. */
export function sameSide(world: World, a: Entity, b: Entity): boolean {
  return ownersCompatible(ownerOf(world, a), ownerOf(world, b));
}

/** The side rule on two owner ids directly: compatible unless both are explicit and differ, so a neutral
 *  entity stays compatible with anyone. */
export function ownersCompatible(a: number | undefined, b: number | undefined): boolean {
  return a === undefined || b === undefined || a === b;
}

/** {@link ownersCompatible} as a per-candidate predicate - the `onSide` gate the candidate scans take. */
export function sameSideAs(world: World, owner: number | undefined): (e: Entity) => boolean {
  return (e) => ownersCompatible(owner, ownerOf(world, e));
}

/**
 * Stamp an {@link Owner} on `e` when `owner` is a valid player slot; an omitted or out-of-range `owner`
 * leaves the entity neutral. A command naming an out-of-range slot never reaches here, because the command
 * system rejects it before the spawn (`systems/command/authority.ts`). Handing an entity to the owner it
 * already has writes nothing, so the caches keyed on the owner store survive a script repeating it.
 */
export function stampOwner(world: World, e: Entity, owner: number | undefined): void {
  if (owner === undefined || !isValidPlayer(owner) || ownerOf(world, e) === owner) return;
  world.add(e, Owner, { player: owner });
}
