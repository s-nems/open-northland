import type { ContentSet } from '@open-northland/data';
import { MissionObjectId, Owner, Vehicle, type VehicleStateView } from '../../components/index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
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

/** Whether a vehicle's own state puts it on a per-tick drive. Reads the `Vehicle` value and the content
 *  only, so a list keyed on it is caught up from that store's journals. */
export type VehicleWorkFilter = (content: ContentSet, state: VehicleStateView) => boolean;

const byId = (e: Entity): number => e;

/** One filter's vehicles in ascending id, kept across ticks and caught up by {@link vehiclesAtWork}. */
class VehicleWorkList {
  private readonly ids: Entity[] = [];
  private frozen: readonly Entity[] | null = null;
  readonly captures: JournaledCaptures<true>;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
    private readonly filter: VehicleWorkFilter,
  ) {
    this.captures = new JournaledCaptures<true>(
      world,
      { membership: [Vehicle], values: [Vehicle] },
      () => world.canonicalQuery(Vehicle),
      {
        capture: (e) => (this.matches(e) ? true : null),
        apply: (e) => {
          insertSortedById(this.ids, e, byId);
          this.frozen = null;
        },
        withdraw: (e) => {
          removeSortedById(this.ids, e, byId);
          this.frozen = null;
        },
        clear: () => {
          this.ids.length = 0;
          this.frozen = null;
        },
      },
    );
  }

  private matches(e: Entity): boolean {
    const state = this.world.tryGet(e, Vehicle);
    return state !== undefined && this.filter(this.content, state);
  }

  /** The matching vehicles as of the last catch-up, shared and frozen. */
  list(): readonly Entity[] {
    this.frozen ??= Object.freeze(this.ids.slice());
    return this.frozen;
  }

  verify(): string[] {
    this.captures.catchUp();
    const held = this.list();
    const fresh = this.world.canonicalQuery(Vehicle).filter((e) => this.matches(e));
    const same = fresh.length === held.length && fresh.every((e, i) => e === held[i]);
    return same ? [] : ['vehiclesAtWork disagrees with a fresh vehicle scan'];
  }
}

const workListsByWorld = new WeakMap<World, Map<VehicleWorkFilter, VehicleWorkList>>();

/**
 * The vehicles `filter` admits, ascending by id, so a per-tick drive walks the vehicles its task or type
 * puts to work instead of every vehicle. Caught up from the `Vehicle` journals, so a tick in which no
 * vehicle was written costs nothing. `filter` must be a module-level constant: it keys the list.
 */
export function vehiclesAtWork(
  world: World,
  content: ContentSet,
  filter: VehicleWorkFilter,
): readonly Entity[] {
  let lists = workListsByWorld.get(world);
  if (lists === undefined) {
    const created = new Map<VehicleWorkFilter, VehicleWorkList>();
    world.registerCacheVerifier('vehiclesAtWork', () =>
      [...created.values()].flatMap((list) => list.verify()),
    );
    workListsByWorld.set(world, created);
    lists = created;
  }
  const held = lists.get(filter);
  if (held !== undefined && held.content === content) {
    held.captures.catchUp();
    return held.list();
  }
  const fresh = new VehicleWorkList(world, content, filter);
  lists.set(filter, fresh);
  return fresh.list();
}
