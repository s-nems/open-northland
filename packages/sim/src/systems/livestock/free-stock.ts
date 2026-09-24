import { FarmAnimal, Livestock, Owner, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Each player's claimed livestock no farm holds - the stock a breeder may adopt - derived from the
 * `Livestock`, `Owner` and `FarmAnimal` stores and rebuilt only when one of them changes, so a breeder
 * re-planning each tick does not walk every wild animal on the map. A claim re-adds `Owner`, which
 * counts as a membership change.
 */
interface FreeStock {
  readonly key: string;
  readonly byOwner: ReadonlyMap<number, readonly Entity[]>;
}

const memo = new WeakMap<World, FreeStock>();
const NONE: readonly Entity[] = Object.freeze([]);

/** `player`'s free claimed animals, in no promised order. Shared: never mutate it. */
export function freeStockOf(world: World, player: number): readonly Entity[] {
  const key = generationKey(world);
  let held = memo.get(world);
  if (held?.key !== key) {
    if (held === undefined) {
      world.registerCacheVerifier('freeStock', () => {
        const current = memo.get(world);
        if (current === undefined || current.key !== generationKey(world)) return [];
        return sameStock(current.byOwner, deriveStock(world))
          ? []
          : ['freeStock disagrees with a fresh Livestock scan'];
      });
    }
    held = { key, byOwner: deriveStock(world) };
    memo.set(world, held);
  }
  return held.byOwner.get(player) ?? NONE;
}

function generationKey(world: World): string {
  return [
    world.componentGeneration(Livestock),
    world.componentGeneration(Owner),
    world.componentValueGeneration(Owner),
    world.componentGeneration(FarmAnimal),
  ].join(':');
}

function deriveStock(world: World): Map<number, Entity[]> {
  const byOwner = new Map<number, Entity[]>();
  for (const e of world.query(Livestock, Owner, Position)) {
    if (world.has(e, FarmAnimal)) continue;
    const player = world.get(e, Owner).player;
    const stock = byOwner.get(player);
    if (stock === undefined) byOwner.set(player, [e]);
    else stock.push(e);
  }
  return byOwner;
}

function sameStock(
  a: ReadonlyMap<number, readonly Entity[]>,
  b: ReadonlyMap<number, readonly Entity[]>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [player, stock] of a) {
    const other = b.get(player);
    if (other === undefined || other.length !== stock.length || !stock.every((e, i) => e === other[i])) {
      return false;
    }
  }
  return true;
}
