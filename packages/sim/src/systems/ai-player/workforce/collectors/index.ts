export {
  allocateCollectors,
  allocateGenericCollectors,
  type CollectorGround,
  SHORTAGE_BUILDER_FLOOR,
  topUpCollectors,
} from './allocate.js';
export { COLLECTOR_WORKSHOP_BY_GOOD_ID, collectorAnchors } from './anchor.js';
export { FLAG_RELOCATE_EVERY_DECISIONS } from './upkeep.js';
export {
  CIVILIANS_PER_CLEARING_COLLECTOR,
  COLLECTED_GOOD_IDS,
  COLLECTOR_TARGET_BY_GOOD_ID,
  clearingCollectors,
  DEFAULT_COLLECTOR_TARGET,
  GENERIC_COLLECTOR_TARGET,
  LATE_GAME_EXTRA_BUILDING_GATHERERS,
  OPERATORS_PER_EXTRA_GATHERER,
  type WantedGood,
  wantedCollectorGoods,
} from './wanted-goods.js';
