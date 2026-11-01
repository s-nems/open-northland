import { StepBuffer, StepGate, type TerrainGraph } from '../terrain/index.js';

/** `cameFrom` of the start node, which has no predecessor. */
export const NO_NODE = -1;
/** `heapIdx` of a settled node. A settled node is never re-expanded. */
export const SETTLED = -1;

/** Open-set slots a scratch starts with; the heap doubles past it, up to one slot per node. */
export const INITIAL_HEAP_CAPACITY = 4096;

/**
 * Reusable per-graph A* storage: one slot per node for what a search keeps about every node it reaches,
 * and a growable open set for what only an open node needs. A node's slots are valid only while its
 * stamp equals the current query generation; anything else is stale and counts as undiscovered, so reuse
 * leaks no state. Typed arrays rather than an object per node, so a search allocates nothing that
 * outlives it.
 *
 * Costs hold a `Fixed`'s scaled integer, exact in a double below 2^53. A node's heuristic is its open
 * slot's `f` minus its `g`.
 */
export interface SearchScratch {
  readonly stamps: Int32Array;
  /** Best known cost from the start. */
  readonly g: Float64Array;
  /** Predecessor on the best known path, {@link NO_NODE} for the start. */
  readonly cameFrom: Int32Array;
  /** Position in `heap` while open, kept by the sift ops so a relaxation can decrease-key in place;
   *  {@link SETTLED} once popped. */
  readonly heapIdx: Int32Array;
  /** The open set, a 4-ary min-heap of node ids in its first {@link heapSize} slots. A node enters it at
   *  most once per search, so it never needs more slots than the graph has nodes. */
  heap: Int32Array;
  /** `g` plus the heuristic of the node in the same heap slot. */
  heapF: Float64Array;
  /** The `g` of the node in the same heap slot, the order's second key, kept beside `f` so a sift reads
   *  no per-node slot. */
  heapG: Float64Array;
  /** The integer deviation from the start-to-goal line of the node in the same heap slot, the
   *  visual-straightness tie-break. A pure function of the node and endpoints, never path-dependent. */
  heapDev: Float64Array;
  heapSize: number;
  /** The settled node's outgoing edges, re-filled per expansion. */
  readonly steps: StepBuffer;
  /** The search's step gate, reset when a search claims the scratch. */
  readonly gate: StepGate;
  /** Generation counter, incremented per query. */
  query: number;
}

/**
 * Which of a graph's two scratches a search runs on. {@link findPath} races a paused forward search
 * against a goal-side one, so each needs node state that survives the other's settles.
 */
export type SearchSide = 'forward' | 'reverse';

const scratchByGraph = new WeakMap<TerrainGraph, Partial<Record<SearchSide, SearchScratch>>>();

function freshScratch(graph: TerrainGraph): SearchScratch {
  const n = graph.nodeCount;
  const heapCapacity = Math.min(n, INITIAL_HEAP_CAPACITY);
  return {
    stamps: new Int32Array(n),
    g: new Float64Array(n),
    cameFrom: new Int32Array(n),
    heapIdx: new Int32Array(n),
    heap: new Int32Array(heapCapacity),
    heapF: new Float64Array(heapCapacity),
    heapG: new Float64Array(heapCapacity),
    heapDev: new Float64Array(heapCapacity),
    heapSize: 0,
    steps: new StepBuffer(),
    gate: new StepGate(),
    query: 0,
  };
}

/** A graph's scratch for `side`, allocated on first use: a graph searched only without an overlay never
 *  allocates the goal side. */
export function scratchFor(graph: TerrainGraph, side: SearchSide): SearchScratch {
  let sides = scratchByGraph.get(graph);
  if (sides === undefined) {
    sides = {};
    scratchByGraph.set(graph, sides);
  }
  let scratch = sides[side];
  if (scratch === undefined) {
    scratch = freshScratch(graph);
    sides[side] = scratch;
  }
  return scratch;
}

/** Stamps are Int32; on the (practically unreachable) wrap, clear them so no stale slot can
 *  collide with a reused generation value. */
export const MAX_QUERY_GENERATION = 2 ** 31 - 1;
