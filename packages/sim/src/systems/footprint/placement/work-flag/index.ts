// WORK-FLAG PLACEMENT — where a work flag (and, through canPlaceWorkFlag, a signpost) may stand: the
// same ../blockers.ts scan the building rule reads, minus the EXCLUSION channel and plus the markers.
// ./incremental-blocks.ts owns the refcounted per-world blocked set; ./queries.ts the placement picks.

export { noteWorkFlagMove, workFlagPlacementBlocks } from './incremental-blocks.js';
export { canPlaceWorkFlag, nearestWorkFlagPlacement, workFlagBlockerVersion } from './queries.js';
