// The leaf, not the terrain barrel: the barrel re-exports `graph.ts`, which imports this module.
import type { NodeId } from './terrain/node-id.js';

/**
 * Node membership plus a non-empty signal, as the navigation layer consumes a walk-block overlay. Any
 * `ReadonlySet<NodeId>` satisfies it, as do wrapped views that answer `has` without materializing a
 * union, so `size`'s only contract is that 0 means empty. Answers must be pure functions of the query,
 * or the searches consuming them stop being deterministic.
 */
export interface BlockOverlay {
  has(node: NodeId): boolean;
  readonly size: number;
}

/**
 * Membership across several node sets without materializing their union, which on a build-heavy map
 * would cost more than the searches it guards. `size` may over-count nodes shared between layers, but it
 * is 0 exactly when every layer is empty. A read view that never mutates a layer, so layers stay safe
 * to share.
 */
export class LayeredBlocks implements BlockOverlay {
  private readonly layers: ReadonlyArray<ReadonlySet<NodeId>>;
  constructor(layers: ReadonlyArray<ReadonlySet<NodeId>>) {
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
