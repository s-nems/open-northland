import { Building, ownerOf, Position, Stockpile } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import { goodEnabled, jobEnabled } from '../../progression/index.js';
import { isLoosePile } from '../../stores/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';
import { countsAsOwnStock, stockOf } from '../stock.js';
import { missionHouses, withinRange } from '../targets.js';

/** The houses carrying the id hold at least `amount` of the good between them, in any slot. */
export function goodsInHousesHolds(pass: MissionPass, id: number, good: number, amount: number): boolean {
  if (amount <= 0) return true; // as the original's `count >= amount` does with nothing to count
  let total = 0;
  for (const e of missionHouses(pass.world, id)) {
    total += stockOf(pass.world, e, good);
    if (total >= amount) return true;
  }
  return false;
}

/** The player's houses hold at least `amount` of the good as their own stock, finished or not. */
export function goodsGlobalHolds(pass: MissionPass, player: number, good: number, amount: number): boolean {
  if (amount <= 0) return true;
  const { world, ctx } = pass;
  let total = 0;
  for (const e of world.query(Building, Stockpile)) {
    if (ownerOf(world, e) !== player) continue;
    if (!countsAsOwnStock(ctx, world.get(e, Building).buildingType, good)) continue;
    total += stockOf(world, e, good);
    if (total >= amount) return true;
  }
  return false;
}

type AreaGoodsGoal = Extract<
  MissionGoalOp,
  { opcode: 'NumberOfGoodsInArea' | 'NumberOfGoodsInHousesInArea' }
>;

/** Goods on the ground within range plus what the player's finished houses there hold as their own
 *  stock reach the amount. */
export function goodsInAreaHolds(pass: MissionPass, op: AreaGoodsGoal): boolean {
  if (op.amount <= 0) return true;
  return groundGoodsInRange(pass, op) + houseGoodsInRange(pass, op) >= op.amount;
}

export function goodsInHousesInAreaHolds(pass: MissionPass, op: AreaGoodsGoal): boolean {
  if (op.amount <= 0) return true;
  return houseGoodsInRange(pass, op) >= op.amount;
}

function groundGoodsInRange(pass: MissionPass, op: AreaGoodsGoal): number {
  const { world } = pass;
  let total = 0;
  for (const e of world.query(Stockpile, Position)) {
    if (!isLoosePile(world, e) || !withinRange(world, e, op.point, op.range)) continue;
    total += stockOf(world, e, op.good);
  }
  return total;
}

function houseGoodsInRange(pass: MissionPass, op: AreaGoodsGoal): number {
  const { world, ctx } = pass;
  let total = 0;
  for (const e of world.query(Building, Stockpile, Position)) {
    const building = world.get(e, Building);
    if (building.built !== ONE || ownerOf(world, e) !== op.player) continue;
    if (!countsAsOwnStock(ctx, building.buildingType, op.good)) continue;
    if (!withinRange(world, e, op.point, op.range)) continue;
    total += stockOf(world, e, op.good);
  }
  return total;
}

export function jobEnabledHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'JobEnabled' }>,
): boolean {
  return jobEnabled(pass.world, pass.ctx, op.player, op.tribe, op.job);
}

export function goodProduceableHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'GoodProduceable' }>,
): boolean {
  return goodEnabled(pass.world, pass.ctx, op.player, op.tribe, op.good);
}
