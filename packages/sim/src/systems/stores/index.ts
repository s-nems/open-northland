// The cross-system store and economy read model: what a store can hold, what a workplace makes, and who
// staffs it. A leaf module, so every per-system file can import it without creating cycles.
export {
  bankedSlot,
  isLoosePile,
  isYardHeap,
  lowestStockedGood,
  MAX_GROUND_STACK,
  slottedGoods,
  stockCapacity,
} from './capacity.js';
export {
  constructionBillOf,
  constructionMaterialsPresent,
  constructionTotalUnits,
  constructionTribeOf,
  deliveredConstructionFraction,
  neededConstructionGoods,
  upgradeTierOf,
} from './construction.js';
export { accessibleStockAmounts, setAccessibleStockAmount } from './inventory.js';
export {
  isWorkplaceOperator,
  operatorCountOf,
  operatorSlotCapacity,
  presentOperatorCount,
  presentOperators,
  type WorkplaceOperators,
} from './operators.js';
export { heapReach, type SeatStock } from './seat-stock.js';
export { catchUpSeatStock, seatStockOf } from './seat-stock-ledger.js';
export {
  collectInboundSupply,
  hasInboundSupply,
  type InboundSupplyTally,
  inboundSupplyOf,
  releaseSupplyRun,
  reservedSourceSupplyOf,
  stampSupplyRun,
} from './supply-tally.js';
export {
  buildingProduces,
  buildingWorkerJobs,
  isCarrierJob,
  isWorkplaceOutput,
  mayFetchGoodFrom,
  mergedRecipeOf,
  recipeConsumes,
  recipesByProductOf,
  refillsOwnStock,
  workplaceStocksGood,
  workplaceStoredGoods,
} from './workplace.js';
