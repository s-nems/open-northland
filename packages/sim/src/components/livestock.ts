import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * Marker: this creature is a livestock species (a `catchable` `animaltypes.ini` record - cow, sheep),
 * claimable by a scout and processable at an animal farm. Stamped at spawn from the species' content
 * flag (content is immutable per world, so the stamp cannot go stale), so the husbandry systems query
 * this SMALL store instead of scanning every settler (the scale rule: per-tick work follows the herd,
 * not the population). Value-less; the claim itself is the separate {@link Owner}.
 */
export const Livestock = defineComponent<Record<string, never>>('Livestock');

/**
 * A processing visit in flight: the animal a starting feed cycle booked. It walks to the workplace
 * door, steps inside (`Resting`) for the batch's remainder, and pays the life cost when the batch
 * completes and releases it (`systems/livestock/processing.ts` owns the whole lifecycle).
 */
export const LivestockVisit = defineComponent<{
  /** The workplace whose batch booked this animal. */
  at: Entity;
}>('LivestockVisit');
