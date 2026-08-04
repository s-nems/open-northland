// The cross-system store and economy read model: what a store can hold, what a workplace makes, and who
// staffs it. A leaf module, so every per-system file can import it without creating cycles.
export { bankedSlot, isYardHeap, lowestStockedGood, MAX_GROUND_STACK, stockCapacity } from './capacity.js';
export {
  constructionBillOf,
  constructionMaterialsPresent,
  constructionTotalUnits,
  deliveredConstructionFraction,
  neededConstructionGoods,
  upgradeTierOf,
} from './construction.js';
export {
  isWorkplaceOperator,
  operatorCountOf,
  operatorSlotCapacity,
  presentOperatorCount,
  presentOperators,
  type WorkplaceOperators,
} from './operators.js';
export {
  collectInboundSupply,
  type InboundSupplyTally,
  inboundSupplyOf,
  releaseSupplyRun,
  stampSupplyRun,
} from './supply-tally.js';
export {
  buildingProduces,
  buildingWorkerJobs,
  isCarrierJob,
  mayFetchGoodFrom,
  mergedRecipeOf,
  producesGoodWithoutInputs,
  recipeConsumes,
  recipesByProductOf,
  typeProducesGoodWithoutInputs,
  workplaceStocksGood,
  workplaceStoredGoods,
} from './workplace.js';
