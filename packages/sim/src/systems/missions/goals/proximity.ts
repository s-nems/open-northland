import { Building, ownerOf, Person, Position, Settler, Signpost } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { ContentContext } from '../../context.js';
import { isHeroJob, isSoldierJob } from '../../readviews/index.js';
import { groupsWithinRange } from '../nearby.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';
import { isMissionAnimal, missionHouses, missionHumans, ownedBy, withinRange } from '../targets.js';
import { neededMatches } from './count.js';

/**
 * The range goals: every one measures in map points through `hexDistance`, and every one holds on the
 * first match rather than counting, except the four that carry an `amount`.
 *
 * A goal keyed on an object id reads the id index. One keyed on a player walks the population once:
 * the region index maintains itself against a store generation on the promise that a member never
 * moves, which a walking human breaks, so these goals scan rather than index.
 */

/** Any human with the id stands within `range` of the point. */
export function humansNearPoint(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindPosByHumans' }>,
): boolean {
  return missionHumans(world, op.humanId).some((e) => withinRange(world, e, op.point, op.range));
}

/** Any human of the player stands within `range` of the point. The original also admits a vehicle,
 *  which this build does not simulate. */
export function playerNearPoint(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindPosByPlayersMapMoveable' }>,
): boolean {
  for (const e of world.query(Person, Position)) {
    if (ownedBy(world, e, op.player) && withinRange(world, e, op.point, op.range)) return true;
  }
  return false;
}

export function guideNearPoint(world: World, op: Extract<MissionGoalOp, { opcode: 'DetectGuide' }>): boolean {
  for (const e of world.query(Signpost, Position)) {
    if (ownerOf(world, e) === op.player && withinRange(world, e, op.point, op.range)) return true;
  }
  return false;
}

/** Any human with id A stands within `range` of any human with id B. */
export function humansNearHumans(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindHumansByHumans' }>,
): boolean {
  const others = missionHumans(world, op.otherHumanId);
  if (others.length === 0) return false;
  return groupsWithinRange(world, missionHumans(world, op.humanId), others, op.range);
}

/** Any human with the id stands within `range` of any house with the object id. */
export function humansNearHouses(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindHousesByHumans' }>,
): boolean {
  const houses = missionHouses(world, op.objectId);
  if (houses.length === 0) return false;
  return groupsWithinRange(world, missionHumans(world, op.humanId), houses, op.range);
}

/** Any human with the id has a human of the player within `range` of it. The metric is symmetric,
 *  so the few marked humans are indexed and the population walked once, allocating nothing for it. */
export function playerNearHumans(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindHumansByPlayersMM' }>,
): boolean {
  const marked = missionHumans(world, op.humanId);
  if (marked.length === 0) return false;
  return groupsWithinRange(world, playerHumans(world, op.player), marked, op.range);
}

function* playerHumans(world: World, player: number): Generator<Entity> {
  for (const e of world.query(Person, Position)) if (ownedBy(world, e, player)) yield e;
}

/** At least `amount` non-hero soldiers of the player stand within `range` of the point. */
export function soldiersNearPoint(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'NumberOfSoldiersNearPos' }>,
): boolean {
  return countSoldiersInArea(pass.world, pass.ctx, op.player, op.point, op.range) >= op.amount;
}

/** The player's soldiers within `range` of the point; a hero is not a soldier here. */
export function countSoldiersInArea(
  world: World,
  ctx: ContentContext,
  player: number,
  point: HalfCellNode,
  range: number,
): number {
  return countPlayerHumansInRange(world, player, point, range, (e) =>
    isSoldierJob(ctx.content, world.get(e, Settler).jobType),
  );
}

/** Every human of the player within `range` of the point, soldier or not. */
export function countHumansInArea(world: World, player: number, point: HalfCellNode, range: number): number {
  return countPlayerHumansInRange(world, player, point, range, () => true);
}

/** At least `amount` civilians of the player stand within `range` of the point. A hero satisfies
 *  neither this goal nor the soldier one: the original subtracts it from both counts. */
export function civiliansNearPoint(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'NumberOfCivilainsNearPos' }>,
): boolean {
  const { world, ctx } = pass;
  return (
    countPlayerHumansInRange(world, op.player, op.point, op.range, (e) => {
      const job = world.get(e, Settler).jobType;
      return !isSoldierJob(ctx.content, job) && !isHeroJob(ctx.content, job);
    }) >= op.amount
  );
}

/** The player has at least `amount` finished houses of the type within `range` of the point. */
export function housesInArea(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'NumberOfHousesInArea' }>,
): boolean {
  if (op.amount <= 0) return true; // as the original's `count >= amount` does over an empty area
  return countHousesInArea(world, op.player, op.houseType, op.point, op.range, op.amount) >= op.amount;
}

/** The player's finished houses of the type within `range` of the point, counted up to `limit`. */
export function countHousesInArea(
  world: World,
  player: number,
  houseType: number,
  point: HalfCellNode,
  range: number,
  limit = Number.POSITIVE_INFINITY,
): number {
  let count = 0;
  for (const e of world.query(Building, Position)) {
    const building = world.get(e, Building);
    if (building.buildingType !== houseType || building.built !== ONE) continue;
    if (ownerOf(world, e) !== player || !withinRange(world, e, point, range)) continue;
    if (++count >= limit) break;
  }
  return count;
}

/** The player has at least `amount` animals of the species within `range` of the point. */
export function animalsInArea(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'NumberOfAnimalsInArea' }>,
): boolean {
  const needed = neededMatches(op.amount);
  return countAnimalsInArea(world, op.player, op.tribe, op.point, op.range, needed) >= needed;
}

/** The player's animals of the species within `range` of the point, counted up to `limit`. */
export function countAnimalsInArea(
  world: World,
  player: number,
  tribe: number,
  point: HalfCellNode,
  range: number,
  limit = Number.POSITIVE_INFINITY,
): number {
  return countAnimals(world, player, tribe, limit, (e) => withinRange(world, e, point, range));
}

export function countAnimals(
  world: World,
  player: number,
  tribe: number,
  limit: number,
  keep?: (e: Entity) => boolean,
): number {
  let count = 0;
  for (const e of world.query(Settler, Position)) {
    if (!isMissionAnimal(world, e) || world.get(e, Settler).tribe !== tribe) continue;
    if (!ownedBy(world, e, player) || (keep !== undefined && !keep(e))) continue;
    if (++count >= limit) break;
  }
  return count;
}

/** A count needs no order and no array: these goals run over the player's humans every pass. */
function countPlayerHumansInRange(
  world: World,
  player: number,
  point: HalfCellNode,
  range: number,
  keep: (e: Entity) => boolean,
): number {
  let count = 0;
  for (const e of world.query(Person, Settler, Position)) {
    if (ownedBy(world, e, player) && withinRange(world, e, point, range) && keep(e)) count++;
  }
  return count;
}
