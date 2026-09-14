import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import type { UnlockKind } from './unlocks.js';

const discoveries = defineWorldSingleton<{
  rows: { player: number | null; tribe: number; kind: UnlockKind; typeId: number }[];
}>('TechnologyDiscoveries', 'players', () => ({ rows: [] }));

export const TechnologyDiscoveries = discoveries.component;
const indexes = new WeakMap<World, { generation: string; keys: Set<string> }>();
function key(player: number | null | undefined, tribe: number, kind: UnlockKind, typeId: number): string {
  return `${player ?? 'neutral'}:${tribe}:${kind}:${typeId}`;
}

export function technologyDiscovered(
  world: World,
  player: number | null | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  const generation = `${world.componentGeneration(TechnologyDiscoveries)}:${world.componentValueGeneration(TechnologyDiscoveries)}`;
  let index = indexes.get(world);
  if (index === undefined || index.generation !== generation) {
    index = {
      generation,
      keys: new Set(discoveries.read(world).rows.map((r) => key(r.player, r.tribe, r.kind, r.typeId))),
    };
    indexes.set(world, index);
  }
  return index.keys.has(key(player, tribe, kind, typeId));
}

export function discoverTechnology(
  world: World,
  player: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  if (technologyDiscovered(world, player, tribe, kind, typeId)) return false;
  discoveries.write(world, (state) => {
    state.rows.push({ player: player ?? null, tribe, kind, typeId });
  });
  return true;
}
