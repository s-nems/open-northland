import { type NodeId, StepBuffer, type TerrainGraph } from '../terrain/index.js';

/** `cameFrom` of the start node, which has no predecessor. */
export const NO_NODE = -1;
/** `heapIdx` of a settled node. A settled node is never re-expanded. */
export const SETTLED = -1;

/**
 * Reusable per-graph A* storage, one slot per node. A node's slots are valid only while its stamp equals
 * the current query generation; anything else is stale and counts as undiscovered, so reuse leaks no
 * state. Typed arrays rather than an object per node, so a search allocates nothing that outlives it.
 *
 * Costs hold a `Fixed`'s scaled integer, exact in a double below 2^53. The heuristic is `f - g`.
 */
export interface SearchScratch {
  readonly stamps: Int32Array;
  /** Best known cost from the start. */
  readonly g: Float64Array;
  /** `g` plus the heuristic. */
  readonly f: Float64Array;
  /** The node's integer deviation from the start-to-goal line, the visual-straightness tie-break. A pure
   *  function of the node and endpoints, computed once at discovery and never path-dependent. */
  readonly dev: Float64Array;
  /** Predecessor on the best known path, {@link NO_NODE} for the start. */
  readonly cameFrom: Int32Array;
  /** Position in `heap` while open, kept by the sift ops so a relaxation can decrease-key in place;
   *  {@link SETTLED} once popped. */
  readonly heapIdx: Int32Array;
  /** The open set, a binary min-heap of node ids. */
  readonly heap: NodeId[];
  /** The settled node's outgoing edges, re-filled per expansion. */
  readonly steps: StepBuffer;
  /** Generation counter, incremented per query. */
  query: number;
}

/**
 * Which of a graph's two scratches a search runs on. {@link findPath} races a paused forward search
 * against a goal-side one, so each needs node state that survives the other's settles.
 */
export type SearchSide = 'forward' | 'reverse';

const scratchByGraph = new WeakMap<TerrainGraph, Record<SearchSide, SearchScratch>>();

function freshScratch(graph: TerrainGraph): SearchScratch {
  const n = graph.nodeCount;
  return {
    stamps: new Int32Array(n),
    g: new Float64Array(n),
    f: new Float64Array(n),
    dev: new Float64Array(n),
    cameFrom: new Int32Array(n),
    heapIdx: new Int32Array(n),
    heap: [],
    steps: new StepBuffer(),
    query: 0,
  };
}

export function scratchFor(graph: TerrainGraph, side: SearchSide): SearchScratch {
  let sides = scratchByGraph.get(graph);
  if (sides === undefined) {
    sides = { forward: freshScratch(graph), reverse: freshScratch(graph) };
    scratchByGraph.set(graph, sides);
  }
  return sides[side];
}

/** Stamps are Int32; on the (practically unreachable) wrap, clear them so no stale slot can
 *  collide with a reused generation value. */
export const MAX_QUERY_GENERATION = 2 ** 31 - 1;
