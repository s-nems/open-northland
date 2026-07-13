import type { BlockOverlay, NodeId } from './terrain/index.js';

/**
 * A layered walk-block view over several node sets — a {@link BlockOverlay} that answers membership
 * across all its layers WITHOUT materializing their union. The union copy costs O(Σ|layer|) Set
 * inserts, which on a build-heavy map dwarfs the searches it guards; a caller that only tests
 * membership (A* over the overlay, the move-order goal snap) pays nothing to compose.
 *
 * `size` honours only the interface's "0 means empty" contract — layers may share nodes, so the
 * total may over-count, but it is 0 iff every layer is empty. Purely a read view: it never mutates a
 * layer, so the layers stay safe to share (e.g. the incrementally-cached resource overlay).
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
