// The cross-system STORE/ECONOMY read-model: what a store can hold, what a workplace makes, who
// staffs it, and the home level chain. A leaf module beside ./spatial.ts so every per-system file
// imports these without creating cycles. Split by concern into this folder; import the barrel, not
// the leaves.
export { isYardHeap, lowestStockedGood, MAX_GROUND_STACK, stockCapacity } from './capacity.js';
export {
  constructionBillOf,
  constructionMaterialsPresent,
  constructionTotalUnits,
  deliveredConstructionFraction,
  neededConstructionGoods,
} from './construction.js';
export { homeNextTier } from './housing.js';
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
  isWorkplaceOperator,
  mergedRecipeOf,
  operatorCountOf,
  presentOperatorCount,
  presentOperators,
  recipesByProductOf,
  type WorkplaceOperators,
  workplaceStoredGoods,
} from './workplace.js';
