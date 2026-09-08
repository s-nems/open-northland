import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * Marks a creature of a livestock species (a `catchable` `animaltypes.ini` record), claimable by a scout
 * and processable at an animal farm. Stamped at spawn from the immutable species flag, so the husbandry
 * systems query this small store instead of scanning every settler. The claim itself is {@link Owner}.
 */
export const Livestock = defineComponent<Record<string, never>>('Livestock', 'economy');

/**
 * A processing visit in flight on a booked animal. `systems/livestock/processing.ts` owns the lifecycle,
 * from the walk to the door through the life cost paid when the batch completes.
 */
export const LivestockVisit = defineComponent<{
  /** The workplace whose batch booked this animal. */
  at: Entity;
}>('LivestockVisit', 'economy');
