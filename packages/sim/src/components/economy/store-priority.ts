import { insertSortedById } from '../../core/sorted-id.js';
import { defineComponent, type Entity, type World } from '../../ecs/world.js';
import { defineWorldSingleton } from '../../ecs/world-singleton.js';

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

/** The players who unmarked the coin on one of their barracks; a barracks they finish afterwards gets no
 *  coin mark by default. Sticky for the match. Our own rule, not the original's. */
const barracksCoinOptOut = defineWorldSingleton<{ players: number[] }>(
  'BarracksCoinOptOut',
  'economy',
  () => ({
    players: [],
  }),
);

export const BarracksCoinOptOut = barracksCoinOptOut.component;

/** Whether `player` turned the barracks' default coin mark off. */
export function barracksCoinOptedOut(world: World, player: number): boolean {
  return barracksCoinOptOut.read(world).players.includes(player);
}

/** Turn the barracks' default coin mark off for `player` until the match ends; a repeat writes nothing. */
export function optOutOfBarracksCoin(world: World, player: number): void {
  if (barracksCoinOptedOut(world, player)) return;
  barracksCoinOptOut.write(world, (state) => insertSortedById(state.players, player, (id) => id));
}
