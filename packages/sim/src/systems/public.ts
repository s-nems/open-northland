// Cross-package simulation surface used by app/render. Per-tick systems and implementation helpers
// stay package-private; scenes consume authored-setup constructors, read views, and shared constants.

export { withinNodeRadius } from '../nav/node-metric.js';
export { FATIGUE_SLEEP_THRESHOLD, HUNGER_EAT_THRESHOLD } from './agents/drives-needs.js';
export { createSettler, DEFAULT_SETTLER_HITPOINTS } from './conflict/spawn/index.js';
export { BERRY_REGROW_TICKS, BERRY_STAGE_TICKS, createBerryBush } from './economy/berries.js';
export { isOnMission } from './family/eligibility.js';
export { createResourceNode } from './footprint/resources.js';
export { GROWUP_TICKS, isBaby, isChild } from './lifecycle/ageclass.js';
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
