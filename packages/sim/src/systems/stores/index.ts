// The cross-system store and economy model: what a store can hold and prioritizes, what a workplace makes,
// and who staffs it. A leaf module, so every per-system file can import it without creating cycles.

export { markFinishedBarracksCoin, noteBarracksPriorityLifted } from './barracks-coin.js';
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
  addUndeliveredConstructionGoods,
  constructionBillCovered,
  constructionBillOf,
  constructionMaterialsPresent,
  constructionTotalUnits,
  deliveredConstructionFraction,
  neededConstructionGoods,
  razeSalvageOf,
} from './construction.js';
export { accessibleStockAmounts, setAccessibleStockAmount } from './inventory.js';
export {
  isWorkplaceOperator,
  operatorCountOf,
  presentOperators,
  presentOperatorsInto,
  type StaffedScratch,
  type WorkplaceOperators,
} from './operators.js';
export { liftStorePriority, markStorePriority } from './priority.js';
export { heapReach, type SeatStock } from './seat-stock.js';
export { catchUpSeatStock, seatStockOf, stockAtBuildings } from './seat-stock-ledger.js';
export { collectSupplyTally, type SupplyTally } from './supply-tally.js';
export {
  buildingProduces,
  buildingRowKeepsPriority,
  buildingWorkerJobs,
  isCarrierJob,
  isStorageBuildingType,
  isStorehouseType,
  isWorkplaceOutput,
  keepsOwnStock,
  keepsStorePriority,
  mayFetchGoodFrom,
  mergedRecipeOf,
  recipeConsumes,
  recipesByProductOf,
  refillingGoodsOf,
  refillsOwnStock,
  workplaceStocksGood,
  workplaceStoredGoods,
} from './workplace.js';
