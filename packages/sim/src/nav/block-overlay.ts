// The leaf, not the terrain barrel: the barrel re-exports `graph.ts`, which imports this module.
import type { NodeId } from './terrain/node-id.js';

/**
 * Node membership plus a non-empty signal, as the navigation layer consumes a walk-block overlay.
 * `size`'s only contract is that 0 means empty, so a view may answer `has` without materializing a
 * union. Answers must be pure functions of the query, or the searches consuming them stop being
 * deterministic.
 */
export interface BlockOverlay {
  has(node: NodeId): boolean;
  readonly size: number;
}

/**
 * A walk-block layer's cells with a row-major per-node count beside them, positive exactly on those
 * cells, so a membership test is one array read. The layer's owner keeps both in step.
 */
export interface CountedCells {
  readonly cells: ReadonlySet<NodeId>;
  readonly counts: Uint16Array;
}

/**
 * Membership across counted layers through their per-node counts, never hashing a node. `size` sums the
 * layers' cells, so it may over-count a node two layers share but is 0 exactly when every layer is empty.
 * Reads the live counts, so the owners' later stamps show through.
 */
export class CountedBlocks implements BlockOverlay {
  private readonly layers: readonly CountedCells[];
  private readonly counts: readonly Uint16Array[];
  constructor(layers: readonly CountedCells[]) {
    this.layers = layers;
    this.counts = layers.map((layer) => layer.counts);
  }
  has(node: NodeId): boolean {
    const counts = this.counts;
    for (let i = 0; i < counts.length; i++) {
      if ((counts[i]?.[node] ?? 0) > 0) return true;
    }
    return false;
  }
  get size(): number {
    let total = 0;
    for (const layer of this.layers) total += layer.cells.size;
    return total;
  }
}

/**
 * Membership across several overlays without materializing their union. `size` may over-count nodes
 * shared between layers, but it is 0 exactly when every layer is empty. A read view that never mutates
 * a layer, so layers stay safe to share.
 */
export class LayeredBlocks implements BlockOverlay {
  private readonly layers: readonly BlockOverlay[];
  constructor(layers: readonly BlockOverlay[]) {
    this.layers = layers;
  }
  has(node: NodeId): boolean {
    for (const layer of this.layers) {
      if (layer.has(node)) return true;
    }
    return false;
  }
  get size(): number {
    let total = 0;
    for (const layer of this.layers) total += layer.size;
    return total;
  }
}
