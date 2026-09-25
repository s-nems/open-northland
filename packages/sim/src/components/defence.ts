import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A building the player has switched into defence mode: its owner's civilians run to it ({@link Sheltering})
 * and it fires the house bow at a rate their number sets. Only a finished building whose type carries a
 * `shelterCapacity` holds it. The mode is extracted, the fire is the original's, and who runs for cover
 * is an approximation.
 */
export const DefenceMode = defineComponent<Record<string, never>>('DefenceMode', 'combat');

/**
 * A civilian claimed by a defence-mode building: walking to `shelter`'s door, or already inside. The claim
 * is what `shelterCapacity` counts, so a settler still en route holds its place. Being inside is the
 * separate {@link import('./economy/farming.js').Resting} marker, and only then does it add to the fire.
 */
export const Sheltering = defineComponent<{ shelter: Entity }>('Sheltering', 'combat');
