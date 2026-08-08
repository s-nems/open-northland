import type { Brand } from '../../core/brand.js';

/** A navigation-graph node address: the row-major index `hy * width + hx`, branded so a raw number
 *  can't stand in. One node is a half-cell, finer than and distinct from a full visual cell. */
export type NodeId = Brand<number, 'NodeId'>;
