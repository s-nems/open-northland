import { defineComponent, type Entity, type World } from '../../ecs/world.js';

/**
 * The goods a player marked as priority in one store: while the store has room for one, its own porters
 * fetch it from the owner's other storehouses, workshop output and ground heaps. Our own rule, not the
 * original's. Added with the first marked good and removed with the last.
 */
export const StorePriority = defineComponent<{
  /** Good types, ascending and unique. */
  goods: number[];
}>('StorePriority', 'economy');

const NO_GOODS: readonly number[] = [];

/** The goods `store` prioritizes, ascending; none without a mark. */
export function storePriorityGoods(world: World, store: Entity): readonly number[] {
  return world.tryGet(store, StorePriority)?.goods ?? NO_GOODS;
}

/** Whether `store` prioritizes `goodType`. */
export function prioritizesGood(world: World, store: Entity, goodType: number): boolean {
  return storePriorityGoods(world, store).includes(goodType);
}
