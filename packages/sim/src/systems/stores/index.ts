// The cross-system STORE/ECONOMY read-model: what a store can hold, what a workplace makes, who
// staffs it, and the housing/population counts. A leaf module beside ./spatial.ts (the split of the
// old shared.ts grab-bag) so every per-system file imports these without creating cycles. Split by
// concern into this folder; import the barrel, not the leaves.

export { isYardHeap, lowestStockedGood, MAX_GROUND_STACK, stockCapacity } from './capacity.js';
export {
  constructionMaterialsPresent,
  constructionTotalUnits,
  deliveredConstructionFraction,
  inboundSupply,
  nextNeededConstructionGood,
} from './construction.js';
export { isFood } from './food.js';
export { homeNextTier, housingCapacity, tribePopulation } from './housing.js';
export {
  buildingProduces,
  buildingWorkerJobs,
  isCarrierJob,
  isTemple,
  presentOperatorCount,
  recipeOf,
  workerPresentAt,
} from './workplace.js';
