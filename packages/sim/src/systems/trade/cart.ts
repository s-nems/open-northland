import {
  Carrying,
  cartAmount,
  cartLoad,
  ownerOf,
  recordGoodsTraded,
  TRADE_CART_SLOTS,
  TradeRoute,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { stockOf } from '../missions/stock.js';
import { grantTradeExperience } from '../progression/index.js';
import { edibleGoodFormOf } from '../readviews/food.js';
import { addCarry, dropCarryAtOwnTile } from '../settlers/atomics/effects/goods/carry.js';
import { accessibleStockAmounts, bankedSlot, setAccessibleStockAmount } from '../stores/index.js';
import { activeAgreement } from './agreements.js';
import { sameFoodClass } from './goods.js';

/** Whether the trader is at the stop of another player's house, where the exchange is counted. */
function atForeignStop(world: World, trader: Entity, house: Entity): boolean {
  const route = world.tryGet(trader, TradeRoute);
  return route?.stops.some((stop) => stop.house === house && stop.foreign) === true;
}

/**
 * Resolve one completed `cartLoad`: one unit of `goodType` leaves `from`'s shelf for the trader's cart,
 * in the form it takes outside the house (a dish becomes its edible). At a foreign stop the unit counts
 * toward the agreement's take and the player's trade tally with the house's owner. A cart with no room
 * or a shelf already empty moves nothing.
 */
export function loadCart(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  from: Entity,
  goodType: number,
): void {
  const route = world.tryGet(trader, TradeRoute);
  if (route === undefined || cartLoad(route) >= TRADE_CART_SLOTS) return;
  const stock = accessibleStockAmounts(world, from);
  const have = stock?.get(goodType) ?? 0;
  if (stock === undefined || have <= 0) return;
  setAccessibleStockAmount(world, from, goodType, have - 1);
  const carried = edibleGoodFormOf(ctx.content, goodType);
  const live = world.mut(trader, TradeRoute);
  live.cargo.set(carried, cartAmount(live, carried) + 1);
  if (!atForeignStop(world, trader, from)) return;
  const agreement = activeAgreement(world, trader, route);
  if (agreement === undefined || !sameFoodClass(ctx, carried, agreement.takeGood)) return;
  live.received += 1;
  const player = ownerOf(world, trader);
  const partner = ownerOf(world, from);
  if (player !== undefined && partner !== undefined) recordGoodsTraded(world, player, partner, 1);
}

/**
 * Resolve one completed `cartUnload`: one unit of `goodType` leaves the cart for `store`'s shelf, on the
 * slot the store banks it in; with no room left, or with no store, the unit goes onto the ground at the
 * trader's feet instead. At a foreign stop the unit counts toward the agreement's give. A delivery
 * that lands trains the trader.
 */
export function unloadCart(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  store: Entity | null,
  goodType: number,
): void {
  const route = world.tryGet(trader, TradeRoute);
  if (route === undefined || cartAmount(route, goodType) <= 0) return;
  // A unit the store refuses goes onto the ground through the trader's hands, which must be free of
  // any other good first; a load still held from an earlier refusal keeps this unit aboard.
  const held = world.tryGet(trader, Carrying);
  if (held !== undefined && held.goodType !== goodType) return;
  const live = world.mut(trader, TradeRoute);
  live.cargo.set(goodType, cartAmount(live, goodType) - 1);
  if (store !== null && world.isAlive(store)) {
    const slot = bankedSlot(world, ctx, store, goodType);
    const have = stockOf(world, store, slot.goodType);
    if (have < slot.capacity) {
      setAccessibleStockAmount(world, store, slot.goodType, have + 1);
      grantTradeExperience(world, ctx, trader);
      if (atForeignStop(world, trader, store)) {
        const agreement = activeAgreement(world, trader, route);
        if (agreement !== undefined && sameFoodClass(ctx, goodType, agreement.giveGood)) live.given += 1;
      }
      return;
    }
  }
  addCarry(world, trader, goodType, 1);
  dropCarryAtOwnTile(world, trader);
}
