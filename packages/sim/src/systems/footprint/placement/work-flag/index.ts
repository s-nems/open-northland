// WORK-FLAG PLACEMENT - where a work flag (and, through canPlaceWorkFlag, a signpost) may stand: the
// same ../blockers.ts scan the building rule reads, minus the margin channels. Split into the blocked
// cells a flag is denied, the refcounted per-world set over them, the relocation counter no component
// generation sees, and the placement picks.

export { noteWorkFlagMove } from './flag-moves.js';
export { workFlagPlacementBlocks } from './incremental-blocks.js';
export { canPlaceWorkFlag, nearestWorkFlagPlacement, workFlagBlockerVersion } from './queries.js';
