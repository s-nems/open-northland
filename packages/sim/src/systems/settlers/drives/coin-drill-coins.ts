import type { AtomicAnimation } from '@open-northland/data';
import { CoinDrillOrder, Settler, Stockpile, setStockAmount } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import {
  COIN_DRILL_TERM_TICKS,
  coinDrillClip,
  coinDrillCoinsOf,
  coinDrillPointsOf,
  drillCoinGood,
} from '../../progression/coin-drill.js';
import { grantDrillPoints } from '../../progression/experience.js';
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
 * The coins on `house`'s shelf no man but `self` speaks for: each drilling order to `house` with no paid
 * term running holds one. A soldier is sent, and starts each term, only for a free coin, so a drilling man
 * never takes the coin another is walking to. Our rule. The work scales with the drilling men.
 */
export function freeDrillCoins(world: World, ctx: SystemContext, house: Entity, self: Entity): number {
  let free = drillCoinsAt(world, ctx, house);
  for (const e of world.query(CoinDrillOrder)) {
    if (e === self) continue;
    const order = world.get(e, CoinDrillOrder);
    if (order.house === house && order.stage === 'drill' && order.termTicksLeft <= 0) free -= 1;
  }
  return free;
}

/** End the drilling half of `e`'s coin drill: he steps out of the barracks, a term cut short gives its
 *  coin back, and he walks back on the next planning. */
export function turnBackFromCoinDrill(world: World, ctx: SystemContext, e: Entity): void {
  if (world.tryGet(e, CoinDrillOrder)?.stage !== 'drill') return;
  refundCutTerm(world, ctx, e);
  stepOut(world, e);
  world.mut(e, CoinDrillOrder).stage = 'return';
}

/** Drop `e`'s coin drill, as a player order that takes him does: a term cut short gives its coin back,
 *  and he steps out of the barracks unless another system holds him indoors. */
export function callOffCoinDrill(world: World, ctx: SystemContext, e: Entity): void {
  const order = world.tryGet(e, CoinDrillOrder);
  if (order === undefined) return;
  refundCutTerm(world, ctx, e);
  if (isInside(world, e, order.house) && !heldIndoors(world, e)) stepOut(world, e);
  world.remove(e, CoinDrillOrder);
}

/** Give back the coins of `e`'s term when it is cut before it was served, and end it. Our rule: a cut
 *  term costs nothing and grants nothing. */
function refundCutTerm(world: World, ctx: SystemContext, e: Entity): void {
  const order = world.tryGet(e, CoinDrillOrder);
  if (order === undefined || order.termTicksLeft <= 0) return;
  world.mut(e, CoinDrillOrder).termTicksLeft = 0;
  const coin = drillCoinGood(ctx.content);
  const settler = world.tryGet(e, Settler);
  const clip = settler === undefined ? undefined : coinDrillClip(ctx.content, settler);
  const stock = world.isAlive(order.house) ? world.tryGet(order.house, Stockpile) : undefined;
  if (coin === undefined || clip === undefined || stock === undefined) return;
  setStockAmount(world, order.house, coin, (stock.amounts.get(coin) ?? 0) + coinDrillCoinsOf(clip));
}

/** Whether `e`'s coin drill has a paid term running. */
export function coinDrillTermRuns(world: World, e: Entity): boolean {
  return (world.tryGet(e, CoinDrillOrder)?.termTicksLeft ?? 0) > 0;
}

/**
 * Start `e`'s next term: take the coins `clip`'s `CHANGE_GOLD` events spend off `house`'s shelf and owe
 * {@link COIN_DRILL_TERM_TICKS}. False, taking nothing, when fewer are there or the clip spends none.
 */
export function startCoinDrillTerm(
  world: World,
  ctx: SystemContext,
  e: Entity,
  house: Entity,
  clip: AtomicAnimation,
): boolean {
  const coin = drillCoinGood(ctx.content);
  const stock = world.tryGet(house, Stockpile);
  const coins = coinDrillCoinsOf(clip);
  if (coin === undefined || stock === undefined || coins <= 0 || !world.has(e, CoinDrillOrder)) return false;
  const have = stock.amounts.get(coin) ?? 0;
  if (have < coins) return false;
  setStockAmount(world, house, coin, have - coins);
  world.mut(e, CoinDrillOrder).termTicksLeft = COIN_DRILL_TERM_TICKS;
  return true;
}

/**
 * Charge one completed repetition of `ticks` against `e`'s term, at least one tick so a zero-length clip
 * cannot stall it. A served term grants the points of the clip's `GET_TRAINING` events, and the order
 * then speaks for the next coin.
 */
export function serveCoinDrillRepetition(world: World, ctx: SystemContext, e: Entity, ticks: number): void {
  if (!coinDrillTermRuns(world, e)) return;
  const order = world.mut(e, CoinDrillOrder);
  order.termTicksLeft = Math.max(0, order.termTicksLeft - Math.max(1, ticks));
  if (order.termTicksLeft > 0) return;
  const settler = world.tryGet(e, Settler);
  const clip = settler === undefined ? undefined : coinDrillClip(ctx.content, settler);
  if (clip !== undefined) grantDrillPoints(world, e, coinDrillPointsOf(clip));
}
