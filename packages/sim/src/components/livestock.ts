import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * Marks a livestock species (a `catchable` `animaltypes.ini` record), claimable by a scout and processable
 * at an animal farm. Stamped at spawn from the species' content flag, which is immutable per world, so the
 * husbandry systems query this small store instead of scanning every settler. The claim itself is the
 * separate {@link Owner}.
 */
export const Livestock = defineComponent<Record<string, never>>('Livestock');

/**
 * A processing visit in flight: the animal a starting feed cycle booked. `systems/livestock/processing.ts`
 * owns the lifecycle, from the walk to the door through the life cost paid when the batch completes.
 */
export const LivestockVisit = defineComponent<{
  /** The workplace whose batch booked this animal. */
  at: Entity;
}>('LivestockVisit');
