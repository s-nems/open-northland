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

/** The index and the store generations it was built at: membership of the three stores plus the value
 *  generations a script's owner or id change bumps. */
interface VehicleIndexCache {
  vehicles: number;
  owners: number;
  ownerValues: number;
  missions: number;
  missionValues: number;
  index: VehicleIndex;
}

const NONE: readonly Entity[] = [];
const vehicleIndexCache = new WeakMap<World, VehicleIndexCache>();

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
  const vehicles = world.componentGeneration(Vehicle);
  const owners = world.componentGeneration(Owner);
  const ownerValues = world.componentValueGeneration(Owner);
  const missions = world.componentGeneration(MissionObjectId);
  const missionValues = world.componentValueGeneration(MissionObjectId);
  const cached = vehicleIndexCache.get(world);
  if (
    cached !== undefined &&
    cached.vehicles === vehicles &&
    cached.ownerValues === ownerValues &&
    cached.missions === missions &&
    cached.missionValues === missionValues &&
    // Owners come and go with every birth, death and dropped heap; only a vehicle's own moves the index.
    (cached.owners === owners || noVehicleOwnerMoved(world, cached.owners))
  ) {
    cached.owners = owners;
    return cached.index;
  }
  const index = buildIndex(world);
  if (cached === undefined) {
    world.journalMembership(Owner);
    world.registerCacheVerifier('vehicleIndex', () => verifyVehicleIndex(world));
    vehicleIndexCache.set(world, { vehicles, owners, ownerValues, missions, missionValues, index });
  } else {
    cached.vehicles = vehicles;
    cached.owners = owners;
    cached.ownerValues = ownerValues;
    cached.missions = missions;
    cached.missionValues = missionValues;
    cached.index = index;
  }
  return index;
}

/** Whether the Owner journal replays every change since generation `since` and none touched a vehicle. */
function noVehicleOwnerMoved(world: World, since: number): boolean {
  journalWorld = world;
  vehicleOwnerMoved = false;
  const replayed = world.replayMembershipSince(Owner, since, noteVehicleOwner);
  journalWorld = undefined;
  return replayed && !vehicleOwnerMoved;
}

/** The world {@link noteVehicleOwner} reads, set only while {@link noVehicleOwnerMoved} replays. */
let journalWorld: World | undefined;
let vehicleOwnerMoved = false;
function noteVehicleOwner(entity: Entity): void {
  if (journalWorld?.has(entity, Vehicle)) vehicleOwnerMoved = true;
}

/** The held index, when the next ask would hand it out, must list what a fresh one lists. */
function verifyVehicleIndex(world: World): string[] {
  const cached = vehicleIndexCache.get(world);
  if (
    cached === undefined ||
    cached.vehicles !== world.componentGeneration(Vehicle) ||
    cached.ownerValues !== world.componentValueGeneration(Owner) ||
    cached.missions !== world.componentGeneration(MissionObjectId) ||
    cached.missionValues !== world.componentValueGeneration(MissionObjectId) ||
    (cached.owners !== world.componentGeneration(Owner) && !noVehicleOwnerMoved(world, cached.owners))
  )
    return [];
  const fresh = buildIndex(world);
  const same = (a: readonly Entity[], b: readonly Entity[]): boolean =>
    a.length === b.length && a.every((e, i) => e === b[i]);
  if (!same(cached.index.all, fresh.all)) return ['vehicleIndex lists other vehicles than the store holds'];
  for (const e of fresh.all) {
    const owner = world.tryGet(e, Owner)?.player;
    if (owner !== undefined && !same(cached.index.ownedBy(owner), fresh.ownedBy(owner)))
      return [`vehicleIndex holds a stale owner list for player ${owner}`];
  }
  return [];
}

/** Whether a vehicle's own state puts it on a per-tick drive. Reads the `Vehicle` value and the content
 *  only, so a list keyed on it is caught up from that store's journals. */
export type VehicleWorkFilter = (content: ContentSet, state: VehicleStateView) => boolean;

const byId = (e: Entity): number => e;

/** One filter's vehicles in ascending id, kept across ticks and caught up by {@link vehiclesAtWork}. */
class VehicleWorkList {
  private readonly ids: Entity[] = [];
  private shared: readonly Entity[] | null = null;
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
          this.shared = null;
        },
        withdraw: (e) => {
          removeSortedById(this.ids, e, byId);
          this.shared = null;
        },
        clear: () => {
          this.ids.length = 0;
          this.shared = null;
        },
      },
    );
  }

  private matches(e: Entity): boolean {
    const state = this.world.tryGet(e, Vehicle);
    return state !== undefined && this.filter(this.content, state);
  }

  /** The matching vehicles as of the last catch-up, shared. */
  list(): readonly Entity[] {
    this.shared ??= this.ids.slice();
    return this.shared;
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
