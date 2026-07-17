/**
 * The pick-mode building washes — the pure snapshot projections behind the green/red tint and the
 * click resolution of the two assign modes: workplace (`assign-highlight.ts`) and its residential twin
 * home (`house-highlight.ts`).
 */
export {
  type AssignBuildingInfo,
  assignableJobForBuilding,
  computeAssignHighlight,
  currentTradeSlotAt,
} from './assign-highlight.js';
export {
  computeHouseHighlight,
  familyIdsOf,
  type HouseInfo,
  houseAssignableAt,
} from './house-highlight.js';
