import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A building the player has switched into defence mode: its owner's civilians run to it and shoot from
 * inside ({@link Sheltering}). Only a finished building whose type carries a `shelterCapacity` holds it.
 * The mode is extracted; sheltering civilians and handing them the house bow is an approximation.
 */
export const DefenceMode = defineComponent<Record<string, never>>('DefenceMode');

/**
 * A civilian claimed by a defence-mode building: walking to `shelter`'s door, or already inside. The claim
 * is what `shelterCapacity` counts, so a settler still en route holds its place. Being inside is the
 * separate {@link import('./economy/farming.js').Resting} marker, and only then does it draw the house bow.
 */
export const Sheltering = defineComponent<{ shelter: Entity }>('Sheltering');
