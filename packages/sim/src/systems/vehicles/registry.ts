import { MissionObjectId, Owner, Vehicle } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * The vehicles on the map, by owner and by mission id, each list ascending by entity id. Derived from
 * the `Vehicle`, `Owner` and `MissionObjectId` stores and never hashed or saved: the components are the
 * state, the index only answers the lookups a script result or a seat teardown makes.
 */
export interface VehicleIndex {
  readonly all: readonly Entity[];
  ownedBy(player: number): readonly Entity[];
  withMissionId(id: number): readonly Entity[];
  has(e: Entity): boolean;
}

interface VehicleIndexCache {
  readonly key: string;
  readonly index: VehicleIndex;
}

const NONE: readonly Entity[] = Object.freeze([]);
const vehicleIndexCache = new WeakMap<World, VehicleIndexCache>();

/** Membership of the three stores plus the value generations a script's owner or id change bumps. */
function indexKey(world: World): string {
  return `${world.componentGeneration(Vehicle)}.${world.componentGeneration(Owner)}.${world.componentValueGeneration(Owner)}.${world.componentGeneration(MissionObjectId)}.${world.componentValueGeneration(MissionObjectId)}`;
}

function buildIndex(world: World): VehicleIndex {
  const all: Entity[] = [];
  const byOwner = new Map<number, Entity[]>();
  const byMission = new Map<number, Entity[]>();
  for (const e of world.query(Vehicle)) all.push(e);
  all.sort((a, b) => a - b);
  for (const e of all) {
    const owner = world.tryGet(e, Owner)?.player;
    if (owner !== undefined) push(byOwner, owner, e);
    const mission = world.tryGet(e, MissionObjectId)?.id;
    if (mission !== undefined) push(byMission, mission, e);
  }
  const members = new Set(all);
  return {
    all,
    ownedBy: (player) => byOwner.get(player) ?? NONE,
    withMissionId: (id) => byMission.get(id) ?? NONE,
    has: (e) => members.has(e),
  };
}

function push(map: Map<number, Entity[]>, key: number, e: Entity): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [e]);
  else list.push(e);
}

/** The current index, rebuilt when any of its inputs changed. The lists are the shared cached copies:
 *  a caller that removes vehicles while walking one must not hold it across the removal, so copy first. */
export function vehicleIndex(world: World): VehicleIndex {
  const key = indexKey(world);
  const cached = vehicleIndexCache.get(world);
  if (cached !== undefined && cached.key === key) return cached.index;
  const index = buildIndex(world);
  vehicleIndexCache.set(world, { key, index });
  return index;
}
