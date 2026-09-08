import { Building, ownerOf, Person, Position, Settler } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { isHeroJob, isSoldierJob } from '../../readviews/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';
import {
  isMissionAnimal,
  missionHouses,
  missionHumans,
  ownedBy,
  withinRange,
  withinRangeOfEach,
} from '../targets.js';

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

/** Any human with id A stands within `range` of any human with id B. */
export function humansNearHumans(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindHumansByHumans' }>,
): boolean {
  const others = missionHumans(world, op.otherHumanId);
  if (others.length === 0) return false;
  return missionHumans(world, op.humanId).some((a) =>
    others.some((b) => withinRangeOfEach(world, a, b, op.range)),
  );
}

/** Any human with the id stands within `range` of any house with the object id. */
export function humansNearHouses(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindHousesByHumans' }>,
): boolean {
  const houses = missionHouses(world, op.objectId);
  if (houses.length === 0) return false;
  return missionHumans(world, op.humanId).some((a) =>
    houses.some((b) => withinRangeOfEach(world, a, b, op.range)),
  );
}

/** Any human with the id has a human of the player within `range` of it. */
export function playerNearHumans(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindHumansByPlayersMM' }>,
): boolean {
  const marked = missionHumans(world, op.humanId);
  if (marked.length === 0) return false;
  for (const e of world.query(Person, Position)) {
    if (!ownedBy(world, e, op.player)) continue;
    if (marked.some((m) => withinRangeOfEach(world, m, e, op.range))) return true;
  }
  return false;
}

/** At least `amount` non-hero soldiers of the player stand within `range` of the point. */
export function soldiersNearPoint(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'NumberOfSoldiersNearPos' }>,
): boolean {
  const { world, ctx } = pass;
  return (
    countPlayerHumansInRange(world, op.player, op.point, op.range, (e) =>
      isSoldierJob(ctx.content, world.get(e, Settler).jobType),
    ) >= op.amount
  );
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
  let count = 0;
  for (const e of world.query(Building, Position)) {
    const building = world.get(e, Building);
    if (building.buildingType !== op.houseType || building.built !== ONE) continue;
    if (ownerOf(world, e) !== op.player || !withinRange(world, e, op.point, op.range)) continue;
    if (++count >= op.amount) return true;
  }
  return false;
}

/** The player has at least `amount` animals of the species within `range` of the point. */
export function animalsInArea(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'NumberOfAnimalsInArea' }>,
): boolean {
  if (op.amount <= 0) return true;
  let count = 0;
  for (const e of world.query(Settler, Position)) {
    if (!isMissionAnimal(world, e) || world.get(e, Settler).tribe !== op.tribe) continue;
    if (!ownedBy(world, e, op.player) || !withinRange(world, e, op.point, op.range)) continue;
    if (++count >= op.amount) return true;
  }
  return false;
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
