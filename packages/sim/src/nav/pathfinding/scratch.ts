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

/**
 * Which of a graph's two scratches a search runs on. {@link findPath} races a paused forward search
 * against a goal-side one, so each needs records that survive the other's settles.
 */
export type SearchSide = 'forward' | 'reverse';

const scratchByGraph = new WeakMap<TerrainGraph, Record<SearchSide, SearchScratch>>();

function freshScratch(graph: TerrainGraph): SearchScratch {
  return {
    records: new Array(graph.nodeCount),
    stamps: new Int32Array(graph.nodeCount),
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
