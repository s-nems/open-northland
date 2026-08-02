// WORK-FLAG PLACEMENT - where a work flag (and, through canPlaceWorkFlag, a signpost) may stand: the
// same ../blockers.ts scan the building rule reads, minus the margin channels. ./blocker-cells.ts owns
// the nodes a flag is denied; ./incremental-blocks.ts the refcounted per-world set over them;
// ./flag-moves.ts the relocation counter no component generation sees; ./queries.ts the placement picks.

export { noteWorkFlagMove } from './flag-moves.js';
export { workFlagPlacementBlocks } from './incremental-blocks.js';
export { canPlaceWorkFlag, nearestWorkFlagPlacement, workFlagBlockerVersion } from './queries.js';
