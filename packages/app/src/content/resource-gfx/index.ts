/**
 * The gathering-economy render binding, split by concern: the pipeline-join resolution into per-good
 * {@link GatheringRefs} (`refs.ts`), the renderer node/trunk/stockpile bindings that consume them
 * (`bindings.ts`), and the two extra resource kinds - the felled-tree stump (`stump.ts`) and the forageable
 * berry bush (`berry-bush.ts`). The reducers are pure; the atlas byte loading and family registration live
 * in `../sprite-sheet/`.
 */

export * from './berry-bush.js';
export * from './bindings.js';
export * from './refs.js';
export * from './stump.js';
