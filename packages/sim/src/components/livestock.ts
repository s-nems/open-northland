import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

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

/**
 * A scout's pending "claim that animal" order - the `claimAnimal` command's marker. The scout walks after
 * the animal under a normal `PlayerOrder`, re-aimed while the animal moves, until the capture pass hands
 * the animal to the scout's player. Dropped when the animal is claimed, gone or no longer claimable, or the
 * walk fails or is interrupted. Named addition: the original claims only what a scout passes.
 */
export const ClaimAnimalOrder = defineComponent<{
  animal: Entity;
  /** The node the scout's walk heads for: the animal's node, snapped walkable, when last aimed. */
  goal: NodeId;
  /** The first tick the walk may be re-aimed at a moved animal. */
  retargetAt: number;
}>('ClaimAnimalOrder', 'settlers');
