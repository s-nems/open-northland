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
  readonly keys: Set<number>;
}

const indexes = new WeakMap<World, DiscoveryIndex>();

/** Exclusive bounds of the fields a discovery key packs, so a read allocates no key string. */
const TYPE_ID_SPAN = 1 << 20;
const TRIBE_SPAN = 1 << 10;
const KIND_INDEX: Readonly<Record<UnlockKind, number>> = { job: 0, house: 1, good: 2 };
const KIND_SPAN = Object.keys(KIND_INDEX).length;
/** The packed player slot of a discovery no player owns. */
const NEUTRAL_SLOT = 0;

/** The discovery packed into one number, or null outside the packable span, which no discovery holds. */
function key(
  player: number | null | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): number | null {
  if (typeId < 0 || typeId >= TYPE_ID_SPAN || tribe < 0 || tribe >= TRIBE_SPAN || (player ?? 0) < 0)
    return null;
  const slot = player === null || player === undefined ? NEUTRAL_SLOT : player + 1;
  return ((slot * TRIBE_SPAN + tribe) * KIND_SPAN + KIND_INDEX[kind]) * TYPE_ID_SPAN + typeId;
}

function deriveKeys(world: World): Set<number> {
  const keys = new Set<number>();
  for (const r of discoveries.read(world).rows) {
    const k = key(r.player, r.tribe, r.kind, r.typeId);
    if (k !== null) keys.add(k);
  }
  return keys;
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
  const k = key(player, tribe, kind, typeId);
  return k !== null && discoveryIndex(world).keys.has(k);
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
  if (discovered === null) {
    throw new Error(
      `technology out of the packable range: player ${player} tribe ${tribe} ${kind} ${typeId}`,
    );
  }
  if (index.keys.has(discovered)) return false;
  discoveries.write(world, (state) => {
    state.rows.push({ player: player ?? null, tribe, kind, typeId });
  });
  index.keys.add(discovered);
  stamp(world, index);
  return true;
}
