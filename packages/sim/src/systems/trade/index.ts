// Trade: a trader's route between two houses, the exchange at a foreign house under the map's
// agreements, and the tally the `NumberOfGoodsTraded` goal reads.

export { activeAgreement, agreementsAt, type HouseAgreement, isTradingHouse } from './agreements.js';
export { applyTradeCommand, canAttachTradeHouse, registerTradeAgreement } from './commands.js';
export { planTrader } from './drive.js';
export { sameFoodClass } from './goods.js';
export {
  fetchFromTradeShip,
  loadTraderHold,
  stowIntoTradeShip,
  TRADE_CART_HOUSE_DISTANCE,
  type TraderHold,
  traderHoldOf,
  unloadTraderHold,
} from './hold.js';
export { AI_STOCK_REFILL_LEVEL, AI_STOCK_REFILL_TURNS, tradePartnerStockSystem } from './partner-stock.js';
export { canPinTradeShip } from './ship.js';
export { traderTakesUpCartSystem } from './take-up.js';
export {
  type TradeOffer,
  type TraderShipState,
  type TraderView,
  type TradeStopView,
  tradeOffersAt,
  tradeOffersOf,
  traderView,
} from './view.js';
export { TRADE_DOCK_RETRY_TICKS, tradeVoyageSystem } from './voyage.js';
