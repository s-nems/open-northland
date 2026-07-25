import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The per-player assistant grant list - the wearable good types the settlement assistant (the chest
 * window's "give everyone ..." switches) may hand out to settlers with a free slot. At most one
 * carrier entity exists per player (the rules-singleton convention; the `setAssistantGrant` command
 * creates/updates/destroys it), so the state hashes and replays like any component, and a command
 * stream that never grants anything leaves every existing golden hash untouched. Which goods a
 * switch maps to is the app's content decision - the sim only reads the good's `equip` class.
 */
export const AssistantGrants = defineComponent<{
  /** The player slot the grants belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  /** Granted good type ids, ascending - canonical for hashing and for a deterministic scan order. */
  goods: readonly number[];
}>('AssistantGrants');

/** The {@link AssistantGrants} carrier for `player`, or null when nothing is granted. Canonical:
 *  the lowest-id carrier wins should more than one ever exist (the rules-singleton convention). */
export function assistantGrantsEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AssistantGrants)) {
    if (world.get(e, AssistantGrants).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

const NO_GRANTS: readonly number[] = [];

/** The good types granted to `player`'s settlers (ascending ids; empty when the assistant is idle). */
export function assistantGrantedGoods(world: World, player: number): readonly number[] {
  const carrier = assistantGrantsEntity(world, player);
  return carrier === null ? NO_GRANTS : world.get(carrier, AssistantGrants).goods;
}
