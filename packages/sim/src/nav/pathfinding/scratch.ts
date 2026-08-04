import type { Fixed } from '../../core/fixed.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../terrain/index.js';

/** A* per-node bookkeeping. `g` = best known cost from start; `f` = g + heuristic; `h` = heuristic. */
export interface NodeRecord {
  readonly node: NodeId;
  g: Fixed;
  f: Fixed;
  h: Fixed;
  /** The node's integer deviation from the start-to-goal line, the visual-straightness tie-break. A pure
   *  function of the node and endpoints, computed once at discovery and never path-dependent. */
  readonly dev: number;
  /** Predecessor node on the best known path, or null for the start node. */
  cameFrom: NodeId | null;
  /** False once popped from the open set; a settled node is never re-expanded. */
  open: boolean;
  /** Position in the open heap while `open`, maintained by the sift ops so a relaxation can
   *  decrease-key in place. Meaningless once closed. */
  heapIdx: number;
}

/**
 * Reusable per-graph search storage. A node's record is valid only while its stamp equals the current
 * query generation; anything else is stale and counts as undiscovered, so reuse leaks no state.
 */
export interface SearchScratch {
  readonly records: Array<NodeRecord | undefined>;
  readonly stamps: Int32Array;
  readonly heap: NodeRecord[];
  /** The settled node's outgoing edges, re-filled per expansion. */
  readonly steps: StepBuffer;
  /** Generation counter, incremented per query. */
  query: number;
}

const scratchByGraph = new WeakMap<TerrainGraph, SearchScratch>();

export function scratchFor(graph: TerrainGraph): SearchScratch {
  let scratch = scratchByGraph.get(graph);
  if (scratch === undefined) {
    scratch = {
      records: new Array(graph.nodeCount),
      stamps: new Int32Array(graph.nodeCount),
      heap: [],
      steps: new StepBuffer(),
      query: 0,
    };
    scratchByGraph.set(graph, scratch);
  }
  return scratch;
}

/** Stamps are Int32; on the (practically unreachable) wrap, clear them so no stale slot can
 *  collide with a reused generation value. */
export const MAX_QUERY_GENERATION = 2 ** 31 - 1;
