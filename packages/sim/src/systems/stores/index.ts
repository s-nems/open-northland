// The cross-system STORE/ECONOMY read-model: what a store can hold, what a workplace makes, who
// staffs it, and the housing/population counts. A leaf module beside ./spatial.ts (the split of the
// old shared.ts grab-bag) so every per-system file imports these without creating cycles. Split by
// concern into this folder; import the barrel, not the leaves.

export { isYardHeap, lowestStockedGood, MAX_GROUND_STACK, stockCapacity } from './capacity.js';
export {
  constructionBillOf,
  constructionMaterialsPresent,
  constructionTotalUnits,
  deliveredConstructionFraction,
  neededConstructionGoods,
  nextNeededConstructionGood,
} from './construction.js';
export { isFood } from './food.js';
export { homeNextTier, housingCapacity, tribePopulation } from './housing.js';
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
  isTemple,
  isWorkplaceOperator,
  mergedRecipeOf,
  presentOperatorCount,
  presentOperators,
  recipesByProductOf,
  workerPresentAt,
  workplaceStoredGoods,
} from './workplace.js';
