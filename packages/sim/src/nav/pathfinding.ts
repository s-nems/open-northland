/**
 * A* pathfinding over the terrain HALF-CELL ADJACENCY GRAPH (docs/plans/, Phase 2).
 *
 * This is the pure search the PathfindingSystem drives. It walks {@link TerrainGraph.steps} (the
 * canonical 8-direction half-cell edge set: E,W then NE,SE,SW,NW then the vertical N,S), using
 * {@link cellLatticeDistance} as the admissible heuristic and each step's own cost (its real world
 * length: half-column ½, diagonal ≈ ¾, half-row ≈ 0.28) as the edge cost. The result is the
 * lowest-cost node sequence from `start` to `goal`, inclusive of both, or `null` when no walkable
 * route exists — minimising TRUE on-screen distance, so a route reads straight under the staggered
 * raster.
 *
 * DETERMINISM: every tie is broken by a fixed, history-independent rule so two runs (or two clients in
 * lockstep) pick byte-identical paths. The open set is a binary min-heap ordered by the TOTAL
 * canonical order (lowest f, then lowest h, then lowest deviation from the start→goal line, then
 * lowest cell id) — with a total order the minimum is UNIQUE, so the root is the canonical pick no
 * matter how the heap's internal layout evolved; a relaxation decreases a record's key in place and
 * sifts it up. Neighbours are expanded in the graph's canonical order. The LINE-DEVIATION key only
 * ever separates routes that already tie on cost, so optimality is untouched — its job is visual:
 * the lattice offers many equal-cost weaves to the same node, and without it the id tie-break picks
 * one that drifts sideways before correcting; with it the route hugs the straight screen line a
 * player expects. It is a pure function of (node, start, goal) world coordinates — no history, so
 * lockstep-safe. No floats touch the search: all costs are {@link Fixed}. `start`/`goal` must be
 * walkable — an unwalkable endpoint yields `null` (no route), not a throw, since it is a
 * recoverable query.
 *
 * PER-GRAPH SCRATCH: the per-node record/stamp arrays and the heap are reused across queries on the
 * same graph (a WeakMap keyed by the graph), so a query allocates records for its DISCOVERED nodes
 * only — never an O(mapArea) backing store per call. A slot is valid only when its generation stamp
 * matches the current query, so stale contents are never read; reuse is invisible to the result.
 */
import { type Fixed, fx } from '../core/fixed.js';
import { type CellId, type TerrainGraph, cellLatticeDistance } from './terrain.js';

/** A* per-node bookkeeping. `g` = best known cost from start; `f` = g + heuristic; `h` = heuristic. */
interface CellRecord {
  readonly cell: CellId;
  g: Fixed;
  f: Fixed;
  h: Fixed;
  /** The node's deviation from the start→goal line (the visual-straightness tie-break) — a PLAIN
   *  integer cross product in half-cell units (only its ordering matters: each axis's true world
   *  scale is a constant factor multiplying both cross terms alike), a pure function of the node +
   *  endpoints computed once at discovery, never path-dependent. Exact integers well under 2^53
   *  even on huge maps — no Fixed mul overflow. */
  readonly dev: number;
  /** Predecessor node on the best known path, or null for the start node. */
  cameFrom: CellId | null;
  /** False once popped from the open set (closed) — a settled node is never re-expanded. */
  open: boolean;
  /** Position in the open heap while `open` — maintained by the sift ops so a relaxation can
   *  decrease-key in place. Meaningless once closed. */
  heapIdx: number;
}

/** The canonical open-set order: (f, h, dev, cell id), all ascending — a TOTAL order (the id last),
 *  so the heap's minimum is unique and the pick is independent of the heap's internal layout. */
function betterRecord(a: CellRecord, b: CellRecord): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  if (a.dev !== b.dev) return a.dev < b.dev;
  return a.cell < b.cell;
}

/** Move `heap[i]` toward the root until its parent is no worse. Maintains `heapIdx`. */
function siftUp(heap: CellRecord[], start: number): void {
  const rec = heap[start];
  if (rec === undefined) return; // callers index within bounds; guard for the checked access
  let i = start;
  while (i > 0) {
    const parentIdx = (i - 1) >> 1;
    const parent = heap[parentIdx];
    if (parent === undefined || !betterRecord(rec, parent)) break;
    heap[i] = parent;
    parent.heapIdx = i;
    i = parentIdx;
  }
  heap[i] = rec;
  rec.heapIdx = i;
}

/** Move `heap[i]` toward the leaves until no child beats it. Maintains `heapIdx`. */
function siftDown(heap: CellRecord[], start: number): void {
  const rec = heap[start];
  if (rec === undefined) return; // callers index within bounds; guard for the checked access
  const n = heap.length;
  let i = start;
  for (;;) {
    let childIdx = 2 * i + 1;
    if (childIdx >= n) break;
    let child = heap[childIdx];
    if (child === undefined) break;
    const right = childIdx + 1 < n ? heap[childIdx + 1] : undefined;
    if (right !== undefined && betterRecord(right, child)) {
      child = right;
      childIdx += 1;
    }
    if (!betterRecord(child, rec)) break;
    heap[i] = child;
    child.heapIdx = i;
    i = childIdx;
  }
  heap[i] = rec;
  rec.heapIdx = i;
}

/**
 * Reusable per-graph search storage. `records[cell]`/`stamps[cell]` are valid only when the stamp
 * equals the current query's generation — everything else is stale garbage from an earlier query
 * and is treated as undiscovered, so reuse can never leak state between queries.
 */
interface SearchScratch {
  readonly records: Array<CellRecord | undefined>;
  readonly stamps: Int32Array;
  readonly heap: CellRecord[];
  /** Generation counter — incremented per query; wraps by refilling `stamps` (see below). */
  query: number;
}

const scratchByGraph = new WeakMap<TerrainGraph, SearchScratch>();

function scratchFor(graph: TerrainGraph): SearchScratch {
  let scratch = scratchByGraph.get(graph);
  if (scratch === undefined) {
    scratch = {
      records: new Array(graph.cellCount),
      stamps: new Int32Array(graph.cellCount),
      heap: [],
      query: 0,
    };
    scratchByGraph.set(graph, scratch);
  }
  return scratch;
}

/** Stamps are Int32; on the (practically unreachable) wrap, clear them so no stale slot can
 *  collide with a reused generation value. */
const MAX_QUERY_GENERATION = 2 ** 31 - 1;

/**
 * Find the lowest-cost walkable path from `start` to `goal` on the half-cell graph, inclusive of
 * both endpoints. Returns `null` when no route exists or either endpoint is unwalkable.
 * `start === goal` yields the single-node path `[start]` (when walkable).
 *
 * `blocked` is the DYNAMIC walk-block overlay (standing building bodies and resource footprints —
 * see `dynamicBlockedCells`), applied on top of the graph's static terrain walkability: a blocked
 * node is never entered (goal included), but a blocked START is deliberately exempt — an entity
 * standing where a foundation just appeared must be able to step OFF the footprint (its first move
 * leaves the blocked node; it can never move back in).
 */
export function findPath(
  graph: TerrainGraph,
  start: CellId,
  goal: CellId,
  blocked?: ReadonlySet<CellId>,
): CellId[] | null {
  if (!graph.isWalkable(start) || !graph.isWalkable(goal)) return null;
  // Already-there wins over the overlay: consistent with the blocked-START exemption, an entity
  // standing on its own (even occupied) goal node trivially succeeds rather than reading "unreachable".
  if (start === goal) return [start];
  if (blocked?.has(goal)) return null; // an occupied goal is unreachable
  // Static-connectivity elision: `blocked` only ever REMOVES edges, so endpoints in different
  // static components are provably unreachable — answer "no route" without flooding the whole
  // reachable component (an island right-click used to cost a full-map Dijkstra). Same component
  // proves nothing (the overlay may still wall the goal off), so the search below runs unchanged.
  if (graph.componentOf(start) !== graph.componentOf(goal)) return null;

  const scratch = scratchFor(graph);
  if (scratch.query >= MAX_QUERY_GENERATION) {
    scratch.stamps.fill(0);
    scratch.query = 0;
  }
  scratch.query += 1;
  const { records, stamps, heap, query } = scratch;
  heap.length = 0;
  const recordAt = (cell: CellId): CellRecord | undefined =>
    stamps[cell] === query ? records[cell] : undefined;

  // The start→goal line for the line-deviation tie-break: a node's deviation is the (unnormalised)
  // cross product |Δnode × Δline| — zero on the line, growing with sideways drift. Computed in PLAIN
  // exact integers over raw half-cell coordinates (each axis's true world scale — ×½ column,
  // ×19/68 column — is a constant factor that multiplies BOTH cross terms alike, so the ordering —
  // all a tie-break needs — is unchanged, while the magnitudes stay ≤ ~2·span², exact far past any
  // map size). Unnormalised is fine: it only ever compares against candidates of the SAME search,
  // so the |Δline| factor cancels too.
  const cs = graph.coordsOf(start);
  const cg = graph.coordsOf(goal);
  const lineHX = cg.x - cs.x;
  const lineHY = cg.y - cs.y;
  const deviation = (cell: CellId): number => {
    const c = graph.coordsOf(cell);
    return Math.abs((c.x - cs.x) * lineHY - (c.y - cs.y) * lineHX);
  };

  // At the start node g is 0, so f === h; compute the heuristic once.
  const startH = cellLatticeDistance(graph, start, goal);
  const startRec: CellRecord = {
    cell: start,
    g: fx.fromInt(0),
    h: startH,
    f: startH,
    dev: 0, // the start sits on its own line by definition
    cameFrom: null,
    open: true,
    heapIdx: 0,
  };
  records[start] = startRec;
  stamps[start] = query;
  heap.push(startRec);

  for (;;) {
    // Pop the canonical minimum from the open set: the heap root — unique under the total order.
    const current = heap[0];
    if (current === undefined) return null; // open set exhausted — unreachable

    if (current.cell === goal) return reconstruct(recordAt, current);

    // Close it — admissible heuristic means it is now settled. Standard root removal: move the
    // last element to the root and sift it down.
    current.open = false;
    const last = heap.pop();
    if (last !== undefined && heap.length > 0) {
      heap[0] = last;
      siftDown(heap, 0);
    }

    // Lattice steps carry their own cost and already exclude blocked/unwalkable nodes, so the
    // search body just relaxes each.
    for (const { cell: next, cost } of graph.steps(current.cell, blocked)) {
      const tentativeG = fx.add(current.g, cost);
      const existing = recordAt(next);
      if (existing === undefined) {
        const h = cellLatticeDistance(graph, next, goal);
        const rec: CellRecord = {
          cell: next,
          g: tentativeG,
          h,
          f: fx.add(tentativeG, h),
          dev: deviation(next),
          cameFrom: current.cell,
          open: true,
          heapIdx: heap.length,
        };
        records[next] = rec;
        stamps[next] = query;
        heap.push(rec);
        siftUp(heap, rec.heapIdx);
      } else if (existing.open && tentativeG < existing.g) {
        // A cheaper route to an already-discovered, still-open node — relax it: its key only
        // DECREASES, so restoring the heap invariant is a sift toward the root. (Closed nodes are
        // never relaxed: with an admissible, consistent heuristic their g is already optimal.)
        existing.g = tentativeG;
        existing.f = fx.add(tentativeG, existing.h);
        existing.cameFrom = current.cell;
        siftUp(heap, existing.heapIdx);
      }
    }
  }
}

/** Walk `cameFrom` back from the goal record to the start, returning the path in start→goal order. */
function reconstruct(recordAt: (cell: CellId) => CellRecord | undefined, goalRec: CellRecord): CellId[] {
  const path: CellId[] = [goalRec.cell];
  let cell: CellId | null = goalRec.cameFrom;
  while (cell !== null) {
    path.push(cell);
    const rec = recordAt(cell);
    // The chain is built only from cells we discovered, so a record must exist; a missing one would
    // be a programmer error in the search above, not a recoverable boundary failure.
    if (rec === undefined) throw new Error(`path reconstruction hit an undiscovered cell ${cell}`);
    cell = rec.cameFrom;
  }
  path.reverse();
  return path;
}
