import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * Marks a creature of a livestock species (a `catchable` `animaltypes.ini` record), claimable by a scout
 * and bred at an animal farm. Stamped at spawn from the immutable species flag, so the husbandry systems
 * query this small store instead of scanning every settler. The claim itself is {@link Owner}.
 */
export const Livestock = defineComponent<Record<string, never>>('Livestock', 'economy');

/**
 * A claimed animal's place in a farm's herd, the original's house attachment: the farm's breeders adopt,
 * breed and slaughter from this set, and its stock rows count it per species. `systems/livestock` owns
 * the lifecycle.
 */
export const FarmAnimal = defineComponent<{
  farm: Entity;
  /** The breeder leading this animal to the farm door for slaughter, or null while it grazes. */
  summoner: Entity | null;
}>('FarmAnimal', 'economy');

/**
 * A bred animal still young (the original's `baby_animal` job 48): it counts in its farm's herd but
 * neither breeds nor is slaughtered before it grows up.
 */
export const YoungAnimal = defineComponent<{
  /** The tick it becomes an adult (`adult_animal` job 49). */
  adultAt: number;
}>('YoungAnimal', 'economy');
