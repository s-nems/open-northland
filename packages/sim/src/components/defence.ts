import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A building the player has switched into DEFENCE MODE - the alarm is up, so its owner's civilians run
 * to it and shoot from inside ({@link Sheltering}). Only a type the content gives a
 * {@link import('@open-northland/data').BuildingType.shelterCapacity} can carry it (the headquarters and
 * the two watchtowers), and only while the building stands finished; the `setDefenceMode` command adds
 * and removes it.
 *
 * Source basis: the mode itself is extracted (the source basis lives with the schema field). What the
 * mode DOES - shelter the civilians, and put the house bow in the grown ones' hands
 * (`systems/defence/manning.ts`) - is our named approximation: no readable record carries the garrison
 * semantics.
 */
export const DefenceMode = defineComponent<Record<string, never>>('DefenceMode');

/**
 * A civilian claimed by a defence-mode building: it is walking to `shelter`'s door, or already inside it.
 * The claim is what {@link import('@open-northland/data').BuildingType.shelterCapacity} counts, so a
 * settler still en route holds its place and the crowd splits across the enabled buildings instead of
 * all piling into the nearest one. The DefenceSystem drops it when the shelter stops qualifying (mode
 * off, razed, re-opened as an upgrade site), and the settler is then free to claim another.
 *
 * Being INSIDE is the separate {@link import('./economy/farming.js').Resting} marker
 * (`systems/settlers/indoors.ts` owns it) - a sheltering settler carries both only once it arrives, and
 * only then does it draw the house bow.
 */
export const Sheltering = defineComponent<{ shelter: Entity }>('Sheltering');
