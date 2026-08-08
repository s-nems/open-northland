// The placement rules - what may be put down where. One store walk (./blockers.ts) enumerates every
// (cell, channel) a standing entity contributes; ./building.ts consumes them through one memoized mask
// grid behind both the command gate and the overlay probe, and ./work-flag/ covers flags and signposts.

export { placementBlockerVersion } from './blockers.js';
export { canPlaceBuilding, type PlacementProbe, placementProbe } from './building.js';
export {
  canPlaceWorkFlag,
  nearestWorkFlagPlacement,
  noteWorkFlagMove,
  workFlagBlockerVersion,
  workFlagPlacementBlocks,
} from './work-flag/index.js';
