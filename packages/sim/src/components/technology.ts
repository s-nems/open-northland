import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import type { UnlockKind } from './unlocks.js';

const discoveries = defineWorldSingleton<{
  rows: { player: number | null; tribe: number; kind: UnlockKind; typeId: number }[];
}>('TechnologyDiscoveries', 'players', () => ({ rows: [] }));

export const TechnologyDiscoveries = discoveries.component;

/** The discovered rows as a key set, valid while the store's generations match. A discovery adds its
 *  key in place, so a cascade of N discoveries costs N inserts rather than N rebuilds of every row. */
interface DiscoveryIndex {
  membership: number;
  values: number;
  readonly keys: Set<string>;
}

const indexes = new WeakMap<World, DiscoveryIndex>();

function key(player: number | null | undefined, tribe: number, kind: UnlockKind, typeId: number): string {
  return `${player ?? 'neutral'}:${tribe}:${kind}:${typeId}`;
}

function deriveKeys(world: World): Set<string> {
  return new Set(discoveries.read(world).rows.map((r) => key(r.player, r.tribe, r.kind, r.typeId)));
}

function isCurrent(world: World, index: DiscoveryIndex): boolean {
  return (
    index.membership === world.componentGeneration(TechnologyDiscoveries) &&
    index.values === world.componentValueGeneration(TechnologyDiscoveries)
  );
}

function stamp(world: World, index: DiscoveryIndex): void {
  index.membership = world.componentGeneration(TechnologyDiscoveries);
  index.values = world.componentValueGeneration(TechnologyDiscoveries);
}

function discoveryIndex(world: World): DiscoveryIndex {
  const held = indexes.get(world);
  if (held !== undefined && isCurrent(world, held)) return held;
  if (held === undefined) {
    world.registerCacheVerifier('technologyDiscovered', () => {
      const current = indexes.get(world);
      if (current === undefined || !isCurrent(world, current)) return [];
      const fresh = deriveKeys(world);
      return fresh.size === current.keys.size && [...fresh].every((k) => current.keys.has(k))
        ? []
        : ['technologyDiscovered disagrees with a fresh scan of the discovery rows'];
    });
  }
  const index: DiscoveryIndex = { membership: 0, values: 0, keys: deriveKeys(world) };
  stamp(world, index);
  indexes.set(world, index);
  return index;
}

export function technologyDiscovered(
  world: World,
  player: number | null | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  return discoveryIndex(world).keys.has(key(player, tribe, kind, typeId));
}

export function discoverTechnology(
  world: World,
  player: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  const index = discoveryIndex(world);
  const discovered = key(player, tribe, kind, typeId);
  if (index.keys.has(discovered)) return false;
  discoveries.write(world, (state) => {
    state.rows.push({ player: player ?? null, tribe, kind, typeId });
  });
  index.keys.add(discovered);
  stamp(world, index);
  return true;
}
