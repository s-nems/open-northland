import {
  Building,
  isValidPlayer,
  isWildlife,
  Owner,
  ownerOf,
  Person,
  Position,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../nav/halfcell.js';
import { canonicalById } from '../spatial/nodes.js';
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

/** The entities stamped with mission object `id`, ascending by entity id and narrowed to one kind.
 *  Each answers a fresh array, so a caller may remove or re-stamp what it got back. */
export function missionHumans(world: World, id: number): Entity[] {
  return missionObjects(world, id).filter((e) => isMissionHuman(world, e));
}

export function missionHouses(world: World, id: number): Entity[] {
  return missionObjects(world, id).filter((e) => isMissionHouse(world, e));
}

export function missionAnimals(world: World, id: number): Entity[] {
  return missionObjects(world, id).filter((e) => isMissionAnimal(world, e));
}

/** Everything `player` owns within `range` map points of `point`, ascending by entity id. */
export function ownedInRange(world: World, player: number, point: HalfCellNode, range: number): Entity[] {
  return canonicalById(world.query(Owner, Position)).filter(
    (e) => world.get(e, Owner).player === player && withinRange(world, e, point, range),
  );
}

/** Whether `e` stands within `range` map points of `point`. An entity with no position is nowhere. */
export function withinRange(world: World, e: Entity, point: HalfCellNode, range: number): boolean {
  const at = entityPoint(world, e);
  return at !== undefined && hexDistance(at, point) <= range;
}

/** Whether two entities stand within `range` map points of each other. */
export function withinRangeOfEach(world: World, a: Entity, b: Entity, range: number): boolean {
  const at = entityPoint(world, a);
  return at !== undefined && withinRange(world, b, at, range);
}

/** Whether `e` belongs to the script's `player`: a slot the sim does not know - the wild one above
 *  all - names what it leaves ownerless. */
export function ownedBy(world: World, e: Entity, player: number): boolean {
  const owner = ownerOf(world, e);
  return isValidPlayer(player) ? owner === player : owner === undefined;
}
