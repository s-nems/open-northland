// The placement rules - what may be put down where. One store walk (./blockers.ts) enumerates every
// (cell, channel) a standing entity contributes, and ./blocker-journal.ts replays those stores into the
// incremental caches over them; ./building.ts consumes one count grid behind both the command gate and the
// overlay probe, and ./work-flag/ covers flags and signposts.

export { placementBlockerVersion } from './blockers.js';
export {
  canPlaceBuilding,
  canPlacePalisadeAnchor,
  type PlacementProbe,
  placementProbe,
} from './building.js';
export {
  findVehicleSite,
  reusableVehicleSite,
  VEHICLE_SITE_PLACEMENT_RINGS,
  VEHICLE_SITE_REUSE_RINGS,
  type VehicleSiteVerdict,
} from './vehicle-site.js';
export {
  canPlaceWorkFlag,
  nearestWorkFlagPlacement,
  noteWorkFlagMove,
  workFlagBlockerVersion,
  workFlagPlacementBlocks,
  workFlagPlacementTest,
} from './work-flag/index.js';
