import { FarmAnimal, Position, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Every farm's attached animals, derived from the {@link FarmAnimal} store and rebuilt only when that
 * store's membership or values change (a birth, slaughter, adoption, steal, death or summon), so a
 * breeder re-planning each tick reads its own herd instead of scanning every farm's.
 *
 * A farm animal loses its `Settler` or `Position` only by being destroyed, which also drops its
 * `FarmAnimal`, so the two generations cover the whole three-store query.
 */
interface HerdIndex {
  readonly membership: number;
  readonly values: number;
  /** Members per farm, in the `FarmAnimal` store's order (the query order a scan would give). */
  readonly herds: ReadonlyMap<Entity, readonly Entity[]>;
  /** The farms holding any animal, ascending id. */
  readonly farms: readonly Entity[];
  /** The animals a breeder has taken in hand, in store order. */
  readonly summoned: readonly Entity[];
}

const memo = new WeakMap<World, HerdIndex>();
const NO_ANIMALS: readonly Entity[] = Object.freeze([]);

/** The animals attached to `farm`, in the world's store order. Shared: never mutate it. */
export function herdOf(world: World, farm: Entity): readonly Entity[] {
  return herdIndex(world).herds.get(farm) ?? NO_ANIMALS;
}

/** The farms some animal is attached to, ascending id; a razed farm stays listed until its herd is
 *  released, so a caller checks the farm itself. */
export function herdedFarms(world: World): readonly Entity[] {
  return herdIndex(world).farms;
}

/** The farm animals a breeder has summoned for slaughter, in store order. */
export function summonedAnimals(world: World): readonly Entity[] {
  return herdIndex(world).summoned;
}

function herdIndex(world: World): HerdIndex {
  const membership = world.componentGeneration(FarmAnimal);
  const values = world.componentValueGeneration(FarmAnimal);
  const held = memo.get(world);
  if (held !== undefined && held.membership === membership && held.values === values) return held;
  if (held === undefined) {
    world.registerCacheVerifier('herdIndex', () => {
      const current = memo.get(world);
      if (current === undefined) return [];
      if (current.membership !== world.componentGeneration(FarmAnimal)) return [];
      if (current.values !== world.componentValueGeneration(FarmAnimal)) return [];
      return sameIndex(current, deriveIndex(world, current.membership, current.values))
        ? []
        : ['herdIndex disagrees with a fresh FarmAnimal scan'];
    });
  }
  const fresh = deriveIndex(world, membership, values);
  memo.set(world, fresh);
  return fresh;
}

function deriveIndex(world: World, membership: number, values: number): HerdIndex {
  const herds = new Map<Entity, Entity[]>();
  const summoned: Entity[] = [];
  for (const e of world.query(FarmAnimal, Settler, Position)) {
    const held = world.get(e, FarmAnimal);
    const herd = herds.get(held.farm);
    if (herd === undefined) herds.set(held.farm, [e]);
    else herd.push(e);
    if (held.summoner !== null) summoned.push(e);
  }
  const farms = [...herds.keys()].sort((a, b) => a - b);
  return { membership, values, herds, farms, summoned };
}

function sameIndex(a: HerdIndex, b: HerdIndex): boolean {
  if (!sameList(a.farms, b.farms) || !sameList(a.summoned, b.summoned)) return false;
  for (const [farm, herd] of a.herds) {
    if (!sameList(herd, b.herds.get(farm) ?? NO_ANIMALS)) return false;
  }
  return a.herds.size === b.herds.size;
}

function sameList(a: readonly Entity[], b: readonly Entity[]): boolean {
  return a.length === b.length && a.every((e, i) => e === b[i]);
}
