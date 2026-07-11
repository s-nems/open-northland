import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The number of PLAYER slots the sim supports for now. Player ids are the half-open range
 * `[0, MAX_PLAYERS)`. A *player* is WHO controls an entity (issues orders, owns the economy) — a
 * concept ORTHOGONAL to a settler/building/vehicle's `tribe` (its civilization/species): two
 * players can both field vikings, and the `tribe` alone can't tell them apart. The cap is a
 * deliberate, revisable ceiling (the plan's "up to N players"), not a fidelity constant — raise
 * it when the lobby / AI-player work needs more slots.
 */
export const MAX_PLAYERS = 16;

/** True when `player` is a valid player slot id — an integer in `[0, MAX_PLAYERS)`. */
export function isValidPlayer(player: number): boolean {
  return Number.isInteger(player) && player >= 0 && player < MAX_PLAYERS;
}

/**
 * Which PLAYER owns/controls this entity (a settler, building, or vehicle). Orthogonal to the
 * `tribe` field those components carry — `tribe` decides look/rules/tech, `Owner.player` decides
 * WHO commands it. It is the gate the app uses to decide which units the human player may select and
 * order (only its own), and the foundation the later friend/foe + AI-player work builds on.
 *
 * A **separate optional component** (the Health/Armor/MoveSpeed/JobAssignment pattern): only an
 * entity spawned WITH a valid `owner` carries one; a neutral/unowned entity — every existing spawn,
 * the golden / vertical-slice path — has none, so adding this component leaves the golden hash
 * untouched. `player` is a plain integer (a slot id, not a position), so it hashes deterministically
 * like every other component. Determinism: set once at spawn from the command data, no RNG /
 * wall-clock.
 */
export const Owner = defineComponent<{ player: number }>('Owner');

/**
 * Stamp an {@link Owner} on `e` when `owner` is a valid player slot; a no-op otherwise (an omitted
 * or out-of-range `owner` leaves the entity neutral). The single stamp point shared by every spawn
 * handler (spawnSettler / placeBuilding / placeBoat), so the validity rule lives in one place. An
 * out-of-range owner is a recoverable bad input — the entity is still created, just unowned — the
 * same skip-don't-throw stance the handlers take for a bad type id.
 */
export function stampOwner(world: World, e: Entity, owner: number | undefined): void {
  if (owner !== undefined && isValidPlayer(owner)) world.add(e, Owner, { player: owner });
}
