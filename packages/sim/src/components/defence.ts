import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A building the player has switched into defence mode, so its owner's civilians run to it and shoot from
 * inside ({@link Sheltering}). Only a finished building whose type carries a `shelterCapacity` can hold it.
 *
 * Source basis: the mode itself is extracted. What the mode does - shelter the civilians and put the house
 * bow in the grown ones' hands - is a named approximation, since no readable record carries the garrison
 * semantics.
 */
export const DefenceMode = defineComponent<Record<string, never>>('DefenceMode');

/**
 * A civilian claimed by a defence-mode building: walking to `shelter`'s door, or already inside. The claim
 * is what `shelterCapacity` counts, so a settler still en route holds its place and the crowd splits across
 * the enabled buildings instead of piling into the nearest one. The DefenceSystem drops it when the shelter
 * stops qualifying, freeing the settler to claim another.
 *
 * Being inside is the separate {@link import('./economy/farming.js').Resting} marker; a sheltering settler
 * carries both only once it arrives, and only then does it draw the house bow.
 */
export const Sheltering = defineComponent<{ shelter: Entity }>('Sheltering');
