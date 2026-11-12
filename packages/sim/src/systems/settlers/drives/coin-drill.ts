import {
  CoinDrillOrder,
  type SettlerIdentity,
  SettlerProgress,
  Stockpile,
  sameSide,
  setStockAmount,
  Weapon,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import {
  COIN_DRILL_ATOMIC_ID,
  coinDrillClip,
  drillCoinGood,
  mayCoinDrill,
} from '../../progression/coin-drill.js';
import { isBarracks } from '../../readviews/index.js';
import { atOrWalk, startAtomic } from '../atomics/start.js';
import { enterBuilding, stepOut } from '../indoors.js';
import type { PlannerContext } from '../planner/context.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import { drillDoorOpen } from './training.js';

const NO_EXPERIENCE: ReadonlyMap<number, number> = new Map();

/**
 * The coin-drill rung: walk a soldier's `CoinDrillOrder` to the barracks door and run one repetition at a
 * time inside while he may drill and the barracks holds a coin no other man speaks for
 * ({@link freeDrillCoins}); otherwise he steps out and walks back to the node he left from, where the order
 * ends. A soldier whose coin was taken out of the stock on his way so walks there and straight back. Our
 * rule.
 */
export function planCoinDrill(plan: PlannerContext, settler: SettlerIdentity): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const order = world.tryGet(e, CoinDrillOrder);
  if (order === undefined) return false;
  if (order.stage === 'drill') {
    const door = interactionCell(world, ctx, terrain, order.house, here);
    const clip = coinDrillClip(ctx.content, settler);
    if (clip !== undefined && drillGoesOn(plan, settler, order.house, door)) {
      const house = order.house;
      enterBuilding(world, e, house, here, door, () => {
        if (freeDrillCoins(world, ctx, house, e) <= 0) {
          turnBackFromCoinDrill(world, e);
          return;
        }
        world.mut(e, CoinDrillOrder).paid = false;
        startAtomic(world, e, COIN_DRILL_ATOMIC_ID, { kind: 'coinDrill', house }, clip.length, house);
      });
      return true;
    }
    turnBackFromCoinDrill(world, e);
  }
  const returnTo = world.get(e, CoinDrillOrder).returnTo;
  const limit = plan.limit;
  if (
    (limit !== null && !limit.allowsNode(returnTo)) ||
    isUnreachableGoal(unreachableGoals(world, ctx, e), returnTo)
  ) {
    world.remove(e, CoinDrillOrder);
    return false;
  }
  atOrWalk(world, e, here, returnTo, () => world.remove(e, CoinDrillOrder));
  return true;
}

/** Whether he keeps on for `house`: his side's barracks still stands, its door is open to him and he may
 *  still drill. */
function drillGoesOn(plan: PlannerContext, settler: SettlerIdentity, house: Entity, door: NodeId): boolean {
  const { world, ctx, entity: e } = plan;
  if (!isBarracks(world, ctx, house) || !sameSide(world, e, house)) return false;
  if (!drillDoorOpen(world, ctx, e, door, plan.limit)) return false;
  const experience = world.tryGet(e, SettlerProgress)?.experience ?? NO_EXPERIENCE;
  return mayCoinDrill(ctx.content, settler, world.tryGet(e, Weapon)?.weaponTypeId, experience);
}

/** The drill coins on `house`'s shelf. */
function drillCoinsAt(world: World, ctx: SystemContext, house: Entity): number {
  const coin = drillCoinGood(ctx.content);
  if (coin === undefined) return 0;
  return world.tryGet(house, Stockpile)?.amounts.get(coin) ?? 0;
}

/**
 * The coins on `house`'s shelf no man but `self` speaks for: each drilling order to `house` whose next
 * repetition has not taken its coin yet holds one. A soldier is sent, and drills each repetition, only for
 * a free coin, so a drilling man never takes the coin another is walking to. Our rule. The work scales
 * with the drilling men.
 */
export function freeDrillCoins(world: World, ctx: SystemContext, house: Entity, self: Entity): number {
  let free = drillCoinsAt(world, ctx, house);
  for (const e of world.query(CoinDrillOrder)) {
    if (e === self) continue;
    const order = world.get(e, CoinDrillOrder);
    if (order.house === house && order.stage === 'drill' && !order.paid) free -= 1;
  }
  return free;
}

/** End the drilling half of `e`'s coin drill: he steps out and walks back on the next planning. */
export function turnBackFromCoinDrill(world: World, e: Entity): void {
  if (!world.has(e, CoinDrillOrder)) return;
  stepOut(world, e);
  const order = world.mut(e, CoinDrillOrder);
  order.stage = 'return';
  order.paid = false;
}

/**
 * Take one repetition's coins off `house`'s shelf for `e`'s drill, the clip's `CHANGE_GOLD` event; false,
 * taking nothing, when fewer are there (another soldier took the last one first).
 */
export function payDrillCoins(
  world: World,
  ctx: SystemContext,
  e: Entity,
  house: Entity,
  coins: number,
): boolean {
  const coin = drillCoinGood(ctx.content);
  const stock = world.tryGet(house, Stockpile);
  if (coin === undefined || stock === undefined) return false;
  const have = stock.amounts.get(coin) ?? 0;
  if (have < coins) return false;
  setStockAmount(world, house, coin, have - coins);
  if (world.has(e, CoinDrillOrder)) world.mut(e, CoinDrillOrder).paid = true;
  return true;
}

/** The repetition's end: its coin is spent, so the order speaks for the next one. */
export function endCoinDrillRepetition(world: World, e: Entity): void {
  if (world.tryGet(e, CoinDrillOrder)?.paid === true) world.mut(e, CoinDrillOrder).paid = false;
}
