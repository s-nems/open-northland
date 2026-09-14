import { Building, ownerOf, Position, Stockpile } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { ContentContext } from '../../context.js';
import { goodEnabled, jobEnabled } from '../../progression/index.js';
import { isLoosePile } from '../../stores/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';
import { countsAsOwnStock, stockOf } from '../stock.js';
import { missionHouses, withinRange } from '../targets.js';
import { countReaches } from './count.js';

/** The houses carrying the id hold at least `amount` of the good between them, in any slot; with
 *  nothing carrying the id the goal fails whatever the amount (reading). */
export function goodsInHousesHolds(pass: MissionPass, id: number, good: number, amount: number): boolean {
  let total = 0;
  for (const e of missionHouses(pass.world, id)) {
    total += stockOf(pass.world, e, good);
    if (total >= amount) return true;
  }
  return false;
}

/** The player's houses hold at least `amount` of the good as their own stock, finished or not; with
 *  no house able to hold it the goal fails whatever the amount (reading). */
export function goodsGlobalHolds(pass: MissionPass, player: number, good: number, amount: number): boolean {
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
  return countGoodsInArea(pass.world, pass.ctx, op.player, op.good, op.point, op.range) >= op.amount;
}

export function goodsInHousesInAreaHolds(pass: MissionPass, op: AreaGoodsGoal): boolean {
  if (op.amount <= 0) return true;
  return houseGoodsInRange(pass.world, pass.ctx, op.player, op.good, op.point, op.range) >= op.amount;
}

/** Goods of the type on the ground within `range` of the point, whoever dropped them, plus what the
 *  player's finished houses there hold as their own stock. The info line's tally reads it too. */
export function countGoodsInArea(
  world: World,
  ctx: ContentContext,
  player: number,
  good: number,
  point: HalfCellNode,
  range: number,
): number {
  return (
    groundGoodsInRange(world, good, point, range) + houseGoodsInRange(world, ctx, player, good, point, range)
  );
}

function groundGoodsInRange(world: World, good: number, point: HalfCellNode, range: number): number {
  let total = 0;
  for (const e of world.query(Stockpile, Position)) {
    if (!isLoosePile(world, e) || !withinRange(world, e, point, range)) continue;
    total += stockOf(world, e, good);
  }
  return total;
}

function houseGoodsInRange(
  world: World,
  ctx: ContentContext,
  player: number,
  good: number,
  point: HalfCellNode,
  range: number,
): number {
  let total = 0;
  for (const e of world.query(Building, Stockpile, Position)) {
    const building = world.get(e, Building);
    if (building.built !== ONE || ownerOf(world, e) !== player) continue;
    if (!countsAsOwnStock(ctx, building.buildingType, good)) continue;
    if (!withinRange(world, e, point, range)) continue;
    total += stockOf(world, e, good);
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
