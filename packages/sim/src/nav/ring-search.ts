import type { NodeId, TerrainGraph } from './terrain/index.js';

/**
 * Max nodes a stand-or-landing ring search visits before giving up, so a boxed-in settler or pile stays
 * put rather than searching the whole world. Approximation: a search-cost guard covering roughly one
 * screen radius at the half-cell lattice's density, not a data-pinned value.
 */
export const STAND_SEARCH_CAP = 192;

/** What a {@link ringSearch} may expand through and what it may stop on. Both tests must be pure: the
 *  canonical pick assumes a node answers the same way whenever it is asked. */
export interface RingSearchProbe {
  /** Nodes the search expands through. Omit to expand through every walkable node, blocked ones
   *  included. */
  readonly traverse?: (node: NodeId) => boolean;
  readonly accept: (node: NodeId) => boolean;
}

const TRAVERSE_ANY = (): boolean => true;

/**
 * The nearest accepted node to `from`, breadth-first over the graph's canonical walkable neighbours and
 * bounded to `cap` visited nodes. The winner is the first accepted node at the minimum ring distance in
 * neighbour order, so reordering the expansion would move the goldens. `cap` guards the outer loop, so a
 * started ring always finishes. `from` is neither tested nor returned and may be unwalkable, such as a
 * click on water, since expansion starts from its walkable neighbours.
 */
export function ringSearch(
  terrain: TerrainGraph,
  from: NodeId,
  cap: number,
  probe: RingSearchProbe,
): NodeId | null {
  const traverse = probe.traverse ?? TRAVERSE_ANY;
  const accept = probe.accept;
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  let visited = 0;
  while (frontier.length > 0 && visited < cap) {
    const next: NodeId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n) || !traverse(n)) continue;
        seen.add(n);
        visited++;
        if (accept(n)) return n;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
