/**
 * The gathering-economy render binding, split by concern: the pipeline-join RESOLUTION into per-good
 * {@link GatheringRefs} (`refs.ts`), the renderer node/trunk/stockpile BINDINGS that consume them
 * (`bindings.ts`), and the two extra resource kinds — the felled-tree STUMP (`stump.ts`) and the
 * forageable BERRY BUSH (`berry-bush.ts`). Each good's node draws ITS own decoded object and each pile
 * draws that good's own `ls_goods` heap growing with its contents. The pure reducers are unit-tested
 * without a browser; the atlas byte loading + family registration live in {@link import('../sprite-sheet/index.js')}.
 */

export * from './berry-bush.js';
export * from './bindings.js';
export * from './refs.js';
export * from './stump.js';
