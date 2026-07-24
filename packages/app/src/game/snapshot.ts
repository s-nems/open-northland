// Snapshot read helpers behind one import seam, split by concern: the general entity/owner/position/
// kind reads (`snapshot-base`) and the marriage/family/residence projection (`snapshot-family`).
export * from './snapshot-base.js';
export * from './snapshot-family.js';
