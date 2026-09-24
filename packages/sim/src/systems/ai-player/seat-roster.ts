import { Building, Owner, Person } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Component, Entity, World } from '../../ecs/world.js';

interface RosterCache {
  readonly memberGeneration: number;
  readonly ownerGeneration: number;
  /** Owner's in-place write channel: a re-own through `World.mut` moves neither membership generation,
   *  so without this key a seat would keep reading the previous holder's roster. */
  readonly ownerValueGeneration: number;
  readonly byPlayer: ReadonlyMap<number, readonly Entity[]>;
}

const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

function sameRoster(held: readonly Entity[] | undefined, fresh: readonly Entity[]): boolean {
  return held !== undefined && held.length === fresh.length && fresh.every((e, i) => held[i] === e);
}

/** A per-world memoized reader for the seats' `component` rosters: one scan per generation answers every
 *  seat. Derived read-state, never hashed; the returned list is the shared cached copy, frozen, so a
 *  caller that sorts or reverses it throws at the mutation site. */
function createOwnedRoster(
  component: Component<unknown>,
  name: string,
): (world: World, player: number) => readonly Entity[] {
  const cache = new WeakMap<World, RosterCache>();

  /** The one freshness rule, shared by the read path and the verifier so they cannot disagree. */
  const isFresh = (cached: RosterCache | undefined, world: World): cached is RosterCache =>
    cached !== undefined &&
    cached.memberGeneration === world.componentGeneration(component) &&
    cached.ownerGeneration === world.componentGeneration(Owner) &&
    cached.ownerValueGeneration === world.componentValueGeneration(Owner);

  const derive = (world: World): ReadonlyMap<number, readonly Entity[]> => {
    const byPlayer = new Map<number, Entity[]>();
    for (const e of world.canonicalQuery(component, Owner)) {
      const { player } = world.get(e, Owner);
      const held = byPlayer.get(player);
      if (held === undefined) byPlayer.set(player, [e]);
      else held.push(e);
    }
    for (const roster of byPlayer.values()) Object.freeze(roster);
    return byPlayer;
  };

  const verify = (world: World): string[] => {
    const cached = cache.get(world);
    // A stale key is not a fault: the next read rebuilds and nothing can consume the old rosters.
    if (!isFresh(cached, world)) return [];
    const fresh = derive(world);
    const coherent =
      fresh.size === cached.byPlayer.size &&
      [...fresh].every(([player, roster]) => sameRoster(cached.byPlayer.get(player), roster));
    if (coherent) return [];
    return [`${name} cache disagrees with a fresh derivation: an owner changed outside World.add/mut`];
  };

  return (world, player) => {
    let cached = cache.get(world);
    if (!isFresh(cached, world)) {
      // Registered on the first build only: the verifier closes over `world` alone.
      if (cached === undefined) world.registerCacheVerifier(name, () => verify(world));
      cached = {
        memberGeneration: world.componentGeneration(component),
        ownerGeneration: world.componentGeneration(Owner),
        ownerValueGeneration: world.componentValueGeneration(Owner),
        byPlayer: derive(world),
      };
      cache.set(world, cached);
    }
    return cached.byPlayer.get(player) ?? NO_ENTITIES;
  };
}

/** The seat's buildings (any construction state) in canonical ascending-id order. */
export const ownedBuildings = createOwnedRoster(Building, 'ownedBuildings');

/** The seat's people, canonical ascending-id order; claimed livestock carries an {@link Owner} too, so the
 *  {@link Person} key is what keeps the herd out of the seat's manpower. */
export const ownedSettlers = createOwnedRoster(Person, 'ownedSettlers');

/** Whether the building's construction (or its latest upgrade) is complete. */
export function isBuilt(world: World, e: Entity): boolean {
  return world.get(e, Building).built >= ONE;
}
