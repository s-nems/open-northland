// Cross-package simulation surface used by app/render. Per-tick systems and implementation helpers
// stay package-private; scenes consume authored-setup constructors, read views, and shared constants.

export { withinNodeRadius } from '../nav/node-metric.js';
export {
  FATIGUE_BUBBLE_THRESHOLD,
  FATIGUE_SLEEP_THRESHOLD,
  HUNGER_BUBBLE_THRESHOLD,
  HUNGER_EAT_THRESHOLD,
} from './agents/drives-needs.js';
// The AI opening plan's content bindings — exported so the real-content suite can pin every id in
// the plan against the served IR (an unknown id silently skips its entry in the sim).
export { type BuildOrderEntry, DEFAULT_BUILD_ORDER } from './ai-player/build-order/index.js';
export { CARRIER_STAFFED_BUILDING_IDS, OPERATORS_PER_TRADE_BY_BUILDING_ID } from './ai-player/workforce.js';
export { createSettler, DEFAULT_SETTLER_HITPOINTS } from './conflict/spawn/index.js';
export { BERRY_REGROW_TICKS, BERRY_STAGE_TICKS, createBerryBush } from './economy/berries.js';
export { isOnMission } from './family/eligibility.js';
export { createResourceNode } from './footprint/resources.js';
export {
  ADULT_AGE_TICKS,
  CHILD_AGE_TICKS,
  isBaby,
  isChild,
  TICKS_PER_AGE_YEAR,
} from './lifecycle/ageclass.js';
export { EAT_HUNGER_RESTORE, SLEEP_FATIGUE_RESTORE } from './lifecycle/needs.js';
// The need-atomic clip resolution (the civilist fallback + the at-home twin's name), exported so the
// real-content suite can pin both joins against the served IR rather than a fixture.
export {
  atomicDurationForName,
  needAtomicAnimationName,
  needAtomicDuration,
} from './readviews/animations.js';
export { HEADQUARTERS_BUILDING_ID } from './readviews/buildings.js';
export { IDLE_JOB } from './readviews/hud.js';
export { MILITARY_MODE, SCOUT_JOB } from './readviews/stances.js';
export {
  canPlaceSignpost,
  type SignpostProbe,
  type SignpostSite,
  signpostNetwork,
  signpostProbe,
} from './signposts/index.js';
export { isYardHeap, MAX_GROUND_STACK } from './stores/index.js';
export { cellOfNode } from './vision/gates.js';
