import { CoinDrillOrder, Settler, Stockpile, setStockAmount } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { coinDrillClip, coinDrillCoinsOf, drillCoinGood } from '../../progression/coin-drill.js';
import { heldIndoors, isInside, stepOut } from '../indoors.js';

// A coin drill's coin bookkeeping and its call-off, apart from the planner rung: the order guards import
// this, and the rung's imports would close a module cycle through them.

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

/** End the drilling half of `e`'s coin drill: he steps out of the barracks, a repetition cut after its
 *  coin gives it back, and he walks back on the next planning. */
export function turnBackFromCoinDrill(world: World, ctx: SystemContext, e: Entity): void {
  if (world.tryGet(e, CoinDrillOrder)?.stage !== 'drill') return;
  refundCutRepetition(world, ctx, e);
  stepOut(world, e);
  world.mut(e, CoinDrillOrder).stage = 'return';
}

/** Drop `e`'s coin drill, as a player order that takes him does: a repetition cut after its coin gives it
 *  back, and he steps out of the barracks unless another system holds him indoors. */
export function callOffCoinDrill(world: World, ctx: SystemContext, e: Entity): void {
  const order = world.tryGet(e, CoinDrillOrder);
  if (order === undefined) return;
  refundCutRepetition(world, ctx, e);
  if (isInside(world, e, order.house) && !heldIndoors(world, e)) stepOut(world, e);
  world.remove(e, CoinDrillOrder);
}

/** Give back the coin of `e`'s repetition when it was cut after the coin and before the points, and settle
 *  `paid`. Our rule: a cut repetition costs nothing. */
export function refundCutRepetition(world: World, ctx: SystemContext, e: Entity): void {
  const order = world.tryGet(e, CoinDrillOrder);
  if (order?.paid !== true) return;
  world.mut(e, CoinDrillOrder).paid = false;
  const coin = drillCoinGood(ctx.content);
  const settler = world.tryGet(e, Settler);
  const clip = settler === undefined ? undefined : coinDrillClip(ctx.content, settler);
  const stock = world.isAlive(order.house) ? world.tryGet(order.house, Stockpile) : undefined;
  if (coin === undefined || clip === undefined || stock === undefined) return;
  setStockAmount(world, order.house, coin, (stock.amounts.get(coin) ?? 0) + coinDrillCoinsOf(clip));
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

/** The repetition's points landed, or its clip ended: its coin is spent, so the order speaks for the next
 *  one. */
export function settleCoinDrillRepetition(world: World, e: Entity): void {
  if (world.tryGet(e, CoinDrillOrder)?.paid === true) world.mut(e, CoinDrillOrder).paid = false;
}
