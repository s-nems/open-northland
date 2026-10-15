import {
  Building,
  isValidPlayer,
  isWildlife,
  MissionObjectId,
  Owner,
  ownerOf,
  Person,
  Position,
  Rider,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../nav/halfcell.js';
import { vehicleStandNode } from '../footprint/index.js';
import { missionObjects } from './object-index.js';

/** The map point an entity stands on; an entity with no position is nowhere. */
export function entityPoint(world: World, e: Entity): HalfCellNode | undefined {
  const at = world.tryGet(e, Position);
  return at === undefined ? undefined : nodeOfPosition(at.x, at.y);
}

/** What an object id can name. Houses and animals share one id kind, so a lookup says which it wants. */
export function isMissionHuman(world: World, e: Entity): boolean {
  return world.has(e, Person);
}

export function isMissionHouse(world: World, e: Entity): boolean {
  return world.has(e, Building);
}

export function isMissionAnimal(world: World, e: Entity): boolean {
  return isWildlife(world, e);
}

export function isMissionVehicle(world: World, e: Entity): boolean {
  return world.has(e, Vehicle);
}

/** The entities stamped with mission object `id`, ascending by entity id and narrowed to one kind.
 *  Each answers a fresh array, so a caller may remove or re-stamp what it got back. */
export function missionHumans(world: World, id: number): Entity[] {
  return missionObjects(world, id).filter((e) => isMissionHuman(world, e));
}

/** The id every human carries until a map or a script gives it one; the id index does not hold it. */
const NO_MISSION_ID = 0;

/**
 * The humans a script line's human id names, ascending by entity id. Original behavior: ids compare
 * by equality with no exception for 0, so id 0 names every human that was never given one, of every
 * player. Those humans are not indexed, so that case walks the population.
 */
export function scriptedHumans(world: World, id: number): Entity[] {
  if (id !== NO_MISSION_ID) return missionHumans(world, id);
  return world.canonicalQuery(Person).filter((e) => !world.has(e, MissionObjectId));
}

export function missionHouses(world: World, id: number): Entity[] {
  return missionObjects(world, id).filter((e) => isMissionHouse(world, e));
}

export function missionAnimals(world: World, id: number): Entity[] {
  return missionObjects(world, id).filter((e) => isMissionAnimal(world, e));
}

export function missionVehicles(world: World, id: number): Entity[] {
  return missionObjects(world, id).filter((e) => isMissionVehicle(world, e));
}

/** The kinds of stamped entity a briefing's on-screen callback centres the view on. */
export type MissionGroupKind = 'human' | 'vehicle' | 'house';

const GROUP_MEMBERS: Readonly<Record<MissionGroupKind, (world: World, id: number) => Entity[]>> = {
  human: missionHumans,
  vehicle: missionVehicles,
  house: missionHouses,
};

/** The mean map point of the `kind` entities stamped with mission object `id`, each coordinate rounded
 *  toward zero as the original divides; undefined when none stands on the map. The original sums in 16
 *  bits, which wraps for a large group far across a big map; this keeps the true mean (deviation). */
export function missionCentre(world: World, kind: MissionGroupKind, id: number): HalfCellNode | undefined {
  let hx = 0;
  let hy = 0;
  let count = 0;
  for (const e of GROUP_MEMBERS[kind](world, id)) {
    const at = carriedPoint(world, e);
    if (at === undefined) continue;
    hx += at.hx;
    hy += at.hy;
    count++;
  }
  return count === 0 ? undefined : { hx: Math.trunc(hx / count), hy: Math.trunc(hy / count) };
}

/** A rider aboard a vehicle, then a vehicle aboard a ship: the most hops between an entity and the map. */
const MAX_CARRIERS = 2;

/** Where `e` is on the map, as the original reads one carried: a rider aboard stands where its vehicle
 *  stands, a vehicle inside a ship where the ship does. Mission continent checks, `FindPosByHumans` and
 *  briefing callbacks use this; the other proximity checks still treat passengers as off the map. */
export function carriedPoint(world: World, e: Entity): HalfCellNode | undefined {
  const own = entityPoint(world, e);
  if (own !== undefined) return own;
  let at = e;
  for (let hop = 0; hop < MAX_CARRIERS; hop++) {
    const carrier = world.tryGet(at, Rider)?.vehicle ?? world.tryGet(at, Vehicle)?.carrier ?? null;
    if (carrier === null || !world.has(carrier, Vehicle)) return undefined;
    const point = vehicleStandNode(world, carrier);
    if (point !== null) return point;
    at = carrier;
  }
  return undefined;
}

/** Everything `player` owns within `range` map points of `point`, ascending by entity id. */
export function ownedInRange(world: World, player: number, point: HalfCellNode, range: number): Entity[] {
  return world
    .canonicalQuery(Owner, Position)
    .filter((e) => world.get(e, Owner).player === player && withinRange(world, e, point, range));
}

/** Whether `e` stands within `range` map points of `point`. An entity with no position is nowhere. */
export function withinRange(world: World, e: Entity, point: HalfCellNode, range: number): boolean {
  const at = entityPoint(world, e);
  return at !== undefined && hexDistance(at, point) <= range;
}

/** Whether `e` belongs to the script's `player`: a slot the sim does not know - the wild one above
 *  all - names what it leaves ownerless. */
export function ownedBy(world: World, e: Entity, player: number): boolean {
  const owner = ownerOf(world, e);
  return isValidPlayer(player) ? owner === player : owner === undefined;
}
