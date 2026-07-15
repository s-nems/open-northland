import type { Brand } from '../../core/brand.js';

/** A navigation-graph node address: the row-major index `hy * width + hx`, branded so a raw number
 *  can't stand in. One node is a half-cell of a visual tile — the sim's logic lattice is `2W×2H`, so
 *  a node is finer than (and distinct from) a full visual cell `(c, r)` = node `(2c + (r&1), 2r)`. */
export type NodeId = Brand<number, 'NodeId'>;

/**
 * A walk-block overlay as the navigation layer consumes it: node membership plus a non-empty signal.
 * Any `ReadonlySet<NodeId>` satisfies it; routing also passes layered/wrapped views (a per-player
 * composition of several block sets, the probe's start-exemption) that answer `has` without
 * materializing a union — so `size`'s only contract is "0 means empty" (a layered view may over-count
 * shared nodes). A read-only interface: answers must be pure functions of the query for the searches
 * consuming it to stay deterministic.
 */
export interface BlockOverlay {
  has(node: NodeId): boolean;
  readonly size: number;
}
