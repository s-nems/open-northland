import type { NodeId, TerrainGraph, Traversal } from './terrain/index.js';

/**
 * Max nodes a stand-or-landing ring search visits before giving up, so a boxed-in settler or pile stays
 * put rather than searching the whole world. Authored: a search-cost guard covering roughly one screen
 * radius at the half-cell lattice's density, not a data-pinned value.
 */
export const STAND_SEARCH_CAP = 192;

/** What a {@link ringSearch} may expand through and what it may stop on. Both tests must be pure: the
 *  canonical pick assumes a node answers the same way whenever it is asked. */
export interface RingSearchProbe {
  /** Nodes the search expands through. Omit to expand through every node of the traversal class, blocked ones
   *  included. */
  readonly traverse?: (node: NodeId) => boolean;
  readonly accept: (node: NodeId) => boolean;
}

const TRAVERSE_ANY = (): boolean => true;

/**
 * The nearest accepted node to `from`, breadth-first over the graph's lattice neighbours of the traversal
 * class, in their canonical order, and bounded to `cap` visited nodes. The winner is the first accepted
 * node at the minimum ring distance in neighbour order, so reordering the expansion would move the
 * goldens. `cap` guards the outer loop, so a started ring always finishes. `from` is neither tested nor
 * returned and may be unwalkable, such as a click on water, since expansion starts from its traversable
 * neighbours.
 */
export function ringSearch(
  terrain: TerrainGraph,
  from: NodeId,
  cap: number,
  probe: RingSearchProbe,
  traversal: Traversal = 'land',
): NodeId | null {
  const traverse = probe.traverse ?? TRAVERSE_ANY;
  const accept = probe.accept;
  const seen = new Set<NodeId>([from]);
  // One queue holds every ring in turn; `ringStart` and `ringEnd` bound the ring being expanded.
  const queue: NodeId[] = [from];
  // One neighbour array for the search, not one per expanded node.
  const around: NodeId[] = [];
  let ringStart = 0;
  let ringEnd = queue.length;
  let visited = 0;
  while (ringStart < ringEnd && visited < cap) {
    for (let i = ringStart; i < ringEnd; i++) {
      const cell = queue[i];
      if (cell === undefined) continue;
      // Only an untraversable start, a click on water, reaches out across ground no step crosses.
      const stepping = terrain.traversable(cell, traversal);
      const count = terrain.neighboursInto(cell, around);
      for (let k = 0; k < count; k++) {
        const n = around[k];
        if (n === undefined) continue;
        if (!terrain.traversable(n, traversal) || seen.has(n) || !traverse(n)) continue;
        if (stepping && !terrain.joined(cell, n)) continue;
        seen.add(n);
        visited++;
        if (accept(n)) return n;
        queue.push(n);
      }
    }
    ringStart = ringEnd;
    ringEnd = queue.length;
  }
  return null;
}
