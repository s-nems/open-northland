import { FarmAnimal, Livestock, Owner, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Each player's claimed livestock no farm holds - the stock a breeder may adopt - and the wild livestock
 * nobody owns, derived from the `Livestock`, `Owner` and `FarmAnimal` stores and rebuilt only when one of
 * them changes, so a breeder re-planning each tick does not walk every wild animal on the map. A claim
 * re-adds `Owner`, which counts as a membership change.
 */
interface FreeStock {
  readonly key: string;
  readonly byOwner: ReadonlyMap<number, readonly Entity[]>;
  /** Livestock with no owner, in the `Livestock` store's order. */
  readonly wild: readonly Entity[];
}

const memo = new WeakMap<World, FreeStock>();
const NONE: readonly Entity[] = [];

/** `player`'s free claimed animals, in no promised order. Shared: never mutate it. */
export function freeStockOf(world: World, player: number): readonly Entity[] {
  return freeStock(world).byOwner.get(player) ?? NONE;
}

/** The livestock no player owns, in the `Livestock` store's order. Shared: never mutate it. */
export function wildStockOf(world: World): readonly Entity[] {
  return freeStock(world).wild;
}

function freeStock(world: World): FreeStock {
  const key = generationKey(world);
  let held = memo.get(world);
  if (held?.key !== key) {
    if (held === undefined) {
      world.registerCacheVerifier('freeStock', () => {
        const current = memo.get(world);
        if (current === undefined || current.key !== generationKey(world)) return [];
        const fresh = deriveStock(world);
        return sameStock(current.byOwner, fresh.byOwner) && sameList(current.wild, fresh.wild)
          ? []
          : ['freeStock disagrees with a fresh Livestock scan'];
      });
    }
    held = { key, ...deriveStock(world) };
    memo.set(world, held);
  }
  return held;
}

function generationKey(world: World): string {
  return [
    world.componentGeneration(Livestock),
    world.componentGeneration(Owner),
    world.componentValueGeneration(Owner),
    world.componentGeneration(FarmAnimal),
  ].join(':');
}

function deriveStock(world: World): { byOwner: Map<number, Entity[]>; wild: Entity[] } {
  const byOwner = new Map<number, Entity[]>();
  const wild: Entity[] = [];
  for (const e of world.query(Livestock, Position)) {
    const owner = world.tryGet(e, Owner);
    if (owner === undefined) {
      wild.push(e);
      continue;
    }
    if (world.has(e, FarmAnimal)) continue;
    const stock = byOwner.get(owner.player);
    if (stock === undefined) byOwner.set(owner.player, [e]);
    else stock.push(e);
  }
  return { byOwner, wild };
}

function sameStock(
  a: ReadonlyMap<number, readonly Entity[]>,
  b: ReadonlyMap<number, readonly Entity[]>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [player, stock] of a) {
    const other = b.get(player);
    if (other === undefined || !sameList(stock, other)) return false;
  }
  return true;
}

function sameList(a: readonly Entity[], b: readonly Entity[]): boolean {
  return a.length === b.length && a.every((e, i) => e === b[i]);
}
