import type { Brand } from '../../core/brand.js';

/** A navigation-graph node address: the row-major index `hy * width + hx`, branded so a raw number
 *  can't stand in. One node is a half-cell of a visual tile - the sim's logic lattice is `2W×2H`, so
 *  a node is finer than (and distinct from) a full visual cell `(c, r)` = node `(2c + (r&1), 2r)`. */
export type NodeId = Brand<number, 'NodeId'>;
