import {
  isAboardVehicle,
  isValidPlayer,
  MissionObjectId,
  Rider,
  Vehicle,
  VehicleStock,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { vehicleStockGood } from '../../vehicles/stock.js';
import { playerExploredNode } from '../../vision/gates.js';
import { groupsWithinRange } from '../nearby.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';
import { entityPoint, missionHouses, missionHumans, missionVehicles, withinRange } from '../targets.js';

// The vehicle goals of docs/formats/MISSIONS.md: each reads the vehicle index or the id index and
// measures in map points like its human twin. A vehicle riding a carrier has no position and is nowhere.

/** The vehicles with the id hold at least `amount` of the good between them; the sum is compared inside
 *  the loop, so nothing carrying the id fails whatever the amount (reading). */
export function goodsInVehiclesHolds(pass: MissionPass, id: number, good: number, amount: number): boolean {
  let total = 0;
  for (const e of missionVehicles(pass.world, id)) {
    total += vehicleGoodAmount(pass, e, good);
    if (total >= amount) return true;
  }
  return false;
}

/** The units of `good` aboard `e`, read under the hold's alias, so bread asked for counts as the food it
 *  was stowed as. */
function vehicleGoodAmount(pass: MissionPass, e: Entity, good: number): number {
  const { world, ctx } = pass;
  const type = contentIndex(ctx.content).vehicles.get(world.get(e, Vehicle).vehicleType);
  if (type === undefined) return 0;
  const held = vehicleStockGood(ctx.content, type, good);
  if (held === null) return 0;
  return world.tryGet(e, VehicleStock)?.lines.get(held)?.current ?? 0;
}

/** Any vehicle with the id stands on a point the player explored; a slot past the fog's players holds
 *  for any vehicle at all. */
export function vehiclesExploredHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'FindVehicles' }>,
): boolean {
  const vehicles = missionVehicles(pass.world, op.vehicleId);
  if (vehicles.length === 0) return false;
  if (!isValidPlayer(op.player)) return true;
  return vehicles.some((e) => {
    const at = entityPoint(pass.world, e);
    return at !== undefined && playerExploredNode(pass.ctx.fog, op.player, at.hx, at.hy);
  });
}

/** Any vehicle with the id stands within `range` of the point. */
export function vehiclesNearPoint(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindPosByVehicles' }>,
): boolean {
  return missionVehicles(world, op.vehicleId).some((e) => withinRange(world, e, op.point, op.range));
}

/** Any vehicle with id A stands within `range` of any human with id B. */
export function vehiclesNearHumans(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindHumansByVehicles' }>,
): boolean {
  const humans = missionHumans(world, op.humanId);
  if (humans.length === 0) return false;
  return groupsWithinRange(world, missionVehicles(world, op.vehicleId), humans, op.range);
}

/** Any vehicle with id A stands within `range` of any vehicle with id B. */
export function vehiclesNearVehicles(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindVehiclesByVehicles' }>,
): boolean {
  const others = missionVehicles(world, op.otherVehicleId);
  if (others.length === 0) return false;
  return groupsWithinRange(world, missionVehicles(world, op.vehicleId), others, op.range);
}

/** Any vehicle with id A stands within `range` of any house with the object id. */
export function vehiclesNearHouses(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'FindHousesByVehicles' }>,
): boolean {
  const houses = missionHouses(world, op.objectId);
  if (houses.length === 0) return false;
  return groupsWithinRange(world, missionVehicles(world, op.vehicleId), houses, op.range);
}

/** Every human with the id is aboard a vehicle carrying the vehicle id; nobody with the id holds
 *  (reading: the loop over an empty set falls through to true). */
export function humansInVehicleHolds(world: World, humanId: number, vehicleId: number): boolean {
  return missionHumans(world, humanId).every((e) => {
    if (!isAboardVehicle(world, e)) return false;
    const vehicle = world.get(e, Rider).vehicle;
    return world.tryGet(vehicle, MissionObjectId)?.id === vehicleId;
  });
}

/** Any vehicle of the player stands within `range` of the point, the vehicle half of
 *  `FindPosByPlayersMapMoveable`. */
export function playerVehicleNearPoint(
  world: World,
  player: number,
  point: HalfCellNode,
  range: number,
): boolean {
  if (!isValidPlayer(player)) return false;
  return vehicleIndex(world)
    .ownedBy(player)
    .some((e) => withinRange(world, e, point, range));
}

/** The player has at least `amount` vehicles of the type within `range` of the point; the count is
 *  compared after the walk, so 0 holds over an empty area (reading). */
export function vehiclesInAreaHolds(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'NumberOfVehiclesInArea' }>,
): boolean {
  if (op.amount <= 0) return true;
  return countVehiclesInArea(world, op.player, op.vehicleType, op.point, op.range, op.amount) >= op.amount;
}

/** The player's vehicles of the type within `range` of the point, counted up to `limit`. */
export function countVehiclesInArea(
  world: World,
  player: number,
  vehicleType: number,
  point: HalfCellNode,
  range: number,
  limit = Number.POSITIVE_INFINITY,
): number {
  let count = 0;
  for (const e of playerVehiclesOfType(world, player, vehicleType)) {
    if (!withinRange(world, e, point, range)) continue;
    if (++count >= limit) break;
  }
  return count;
}

/** Goods of the type aboard the player's vehicles of the type within `range` of the point reach the
 *  amount, compared after the walk (`Tool_CountGoodsInVehicles`). */
export function goodsInVehiclesInAreaHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'NumberOfGoodsInVehiclesInArea' }>,
): boolean {
  if (op.amount <= 0) return true;
  let total = 0;
  for (const e of playerVehiclesOfType(pass.world, op.player, op.vehicleType)) {
    if (!withinRange(pass.world, e, op.point, op.range)) continue;
    total += vehicleGoodAmount(pass, e, op.good);
    if (total >= op.amount) return true;
  }
  return false;
}

function* playerVehiclesOfType(world: World, player: number, vehicleType: number): Generator<Entity> {
  if (!isValidPlayer(player)) return;
  for (const e of vehicleIndex(world).ownedBy(player)) {
    if (world.get(e, Vehicle).vehicleType === vehicleType) yield e;
  }
}
