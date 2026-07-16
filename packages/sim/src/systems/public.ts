// Cross-package simulation surface used by app/render. Per-tick systems and implementation helpers
// stay package-private; scenes consume authored-setup constructors, read views, and shared constants.
export { createSettler, DEFAULT_SETTLER_HITPOINTS } from './conflict/spawn/index.js';
export { BERRY_REGROW_TICKS, createBerryBush } from './economy/berries.js';
export { createResourceNode } from './footprint/resources.js';
export { MILITARY_MODE, SCOUT_JOB } from './readviews/stances.js';
export {
  canPlaceSignpost,
  type SignpostProbe,
  type SignpostSite,
  signpostNetwork,
  signpostProbe,
  withinNodeRadius,
} from './signposts/index.js';
export { isYardHeap, MAX_GROUND_STACK } from './stores/index.js';
export { cellOfNode } from './vision/gates.js';
