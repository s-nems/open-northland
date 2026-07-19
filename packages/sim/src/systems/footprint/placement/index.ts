// The placement rules — what may be put down where. One store walk (./blockers.ts) enumerates every
// (cell, channel) a standing entity contributes; each rule consumes the channels it cares about:
// ./building.ts (the FREE placement rule, sparse gate + dense overlay probe) and ./work-flag/ (work
// flags and signposts).

export { placementBlockerVersion } from './blockers.js';
export { canPlaceBuilding, type PlacementProbe, placementProbe } from './building.js';
export {
  canPlaceWorkFlag,
  nearestWorkFlagPlacement,
  noteWorkFlagMove,
  workFlagBlockerVersion,
  workFlagPlacementBlocks,
} from './work-flag/index.js';
