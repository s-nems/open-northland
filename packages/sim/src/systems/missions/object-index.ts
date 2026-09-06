import { MissionObjectId } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/** The per-world lookup from a mission object id to the live entities carrying it, rebuilt when the
 *  store changed. Derived from component state alone, so it never changes a simulation result. */
interface MissionObjectIndex {
  readonly members: number;
  readonly values: number;
  readonly byId: Map<number, Entity[]>;
}

const indexes = new WeakMap<World, MissionObjectIndex>();
const NO_ENTITIES: readonly Entity[] = [];

/**
 * The live entities stamped with mission object `id`, ascending by entity id. An id names a group, so
 * every lookup answers a list, and an id nothing carries answers an empty one. Walking the whole
 * population per lookup is what the original does; this index is why a script with hundreds of
 * missions does not.
 *
 * A rebuild is whole-store, so a caller must not interleave lookups with spawns or removals of
 * stamped entities: collect the entities first, then change them.
 */
export function missionObjects(world: World, id: number): readonly Entity[] {
  return indexFor(world).byId.get(id) ?? NO_ENTITIES;
}

/** Every mission object id present in the world, ascending. Allocates and sorts on every call - a
 *  report and test seam, not a per-tick lookup. */
export function missionObjectIds(world: World): number[] {
  return [...indexFor(world).byId.keys()].sort((a, b) => a - b);
}

function indexFor(world: World): MissionObjectIndex {
  // Both generations: a spawn or a removal changes membership, re-stamping an id in place changes
  // only the stored value.
  const members = world.componentGeneration(MissionObjectId);
  const values = world.componentValueGeneration(MissionObjectId);
  const cached = indexes.get(world);
  if (cached !== undefined && cached.members === members && cached.values === values) return cached;
  const byId = new Map<number, Entity[]>();
  for (const e of world.query(MissionObjectId)) {
    const { id } = world.get(e, MissionObjectId);
    const group = byId.get(id);
    if (group === undefined) byId.set(id, [e]);
    else group.push(e);
  }
  // Store order is creation order until an id is re-stamped, which would leave a group unsorted.
  for (const group of byId.values()) group.sort((a, b) => a - b);
  const built = { members, values, byId };
  indexes.set(world, built);
  return built;
}
