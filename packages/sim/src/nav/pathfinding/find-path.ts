/**
 * A* pathfinding over the terrain half-cell adjacency graph. Each edge costs its real world length and
 * the heuristic is the admissible {@link latticeDistanceTo}, so a route minimises true on-screen distance
 * and reads straight under the staggered raster. All costs are fixed-point; no float enters the search.
 *
 * Ties break on a history-independent total order, so two clients in lockstep pick byte-identical paths.
 * The line-deviation key only separates routes that already tie on cost, so optimality is untouched.
 *
 * Working storage is reused per graph, so a query allocates records only for the nodes it discovers.
 */
import { fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import { latticeDistanceTo, type NodeId, type TerrainGraph } from '../terrain/index.js';
import { siftDown, siftUp } from './heap.js';
import { MAX_QUERY_GENERATION, type NodeRecord, scratchFor } from './scratch.js';

/** The canonical open-set order (f, h, dev, node id), all ascending. Ending on the id makes it total, so
 *  the heap's minimum is unique and independent of the heap's internal layout. */
function betterRecord(a: NodeRecord, b: NodeRecord): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  if (a.dev !== b.dev) return a.dev < b.dev;
  return a.node < b.node;
}

/**
 * `explored` counts settled nodes, the unit a search's running time is proportional to. A pure
 * out-parameter, and a deterministic function of the query, so a budget may be keyed on it.
 */
export interface SearchStats {
  explored: number;
}

/**
 * The settle cap of the goal-side pocket probe. A reverse search exhausts a pocket the overlay sealed the
 * goal into at the pocket's own size, and edges are symmetric, so "the goal's region excludes the start"
 * is exactly "no route". Authored: sized above a melee ring's free band and far under a map flood, so an
 * open goal instead beelines to the start or hands over to the full search at this cap.
 */
export const POCKET_PROBE_MAX_EXPLORED = 128;

/**
 * The forward search's settle guard under a walk-block overlay. Past this many settles with no verdict,
 * {@link findPath} suspects a pocket that outgrew {@link POCKET_PROBE_MAX_EXPLORED} and runs the goal-side
 * exhaust rather than flooding the walker's whole region. Observation: refuting a sealed goal forward
 * costs orders of magnitude more settles than exhausting the pocket in reverse. Authored: a performance
 * knob sized above routine long routes; the answer never changes.
 */
export const FLOOD_GUARD_MAX_EXPLORED = 4096;

/**
 * The goal-side exhaust's own settle cap. A pocket larger than this falls back to the full forward flood,
 * bounding how much the exhaust can lose by when both sides are huge.
 */
export const GOAL_EXHAUST_MAX_EXPLORED = 32768;

/**
 * Find the lowest-cost walkable path from `start` to `goal` on the half-cell graph, inclusive of
 * both endpoints. Returns `null` when no route exists or either endpoint is unwalkable.
 * `start === goal` yields the single-node path `[start]` (when walkable).
 *
 * `blocked` is the dynamic walk-block overlay applied on top of static terrain walkability: a blocked node
 * is never entered, the goal included, but a blocked start is exempt so an entity standing where a
 * foundation just appeared can step off the footprint. It can never step back in.
 *
 * `stats` accumulates settled nodes, including the pocket probe's; the early-out answers settle nothing.
 */
export function findPath(
  graph: TerrainGraph,
  start: NodeId,
  goal: NodeId,
  blocked?: BlockOverlay,
  stats?: SearchStats,
): NodeId[] | null {
  if (!graph.isWalkable(start) || !graph.isWalkable(goal)) return null;
  // Already-there wins over the overlay, consistent with the blocked-start exemption.
  if (start === goal) return [start];
  if (blocked?.has(goal)) return null;
  // `blocked` only removes edges, so endpoints in different static components are provably unreachable.
  // Sharing a component proves nothing, since the overlay may still wall the goal off.
  if (graph.componentOf(start) !== graph.componentOf(goal)) return null;
  if (blocked === undefined || blocked.size === 0) {
    // Without an overlay a shared static component means reachable, so the search can never flood.
    const result = runSearch(graph, start, goal, blocked, stats, Number.POSITIVE_INFINITY);
    return typeof result === 'string' ? null : result;
  }
  // The reverse probe re-admits a blocked start as its target: forward, the walker may leave that node but
  // never re-enter it, which in reverse is exactly "enterable as the final step only", so both directions
  // see the same edge set and the probe's "unreachable" stays exact.
  const probeBlocked: BlockOverlay = blocked.has(start)
    ? { has: (n) => n !== start && blocked.has(n), size: blocked.size }
    : blocked;
  const probe = runSearch(graph, goal, start, probeBlocked, stats, POCKET_PROBE_MAX_EXPLORED);
  if (probe === 'unreachable') return null;
  // The guard only aborts a search with no verdict yet, so anything resolving here is byte-identical to
  // the unguarded search.
  const first = runSearch(graph, start, goal, blocked, stats, FLOOD_GUARD_MAX_EXPLORED);
  if (first !== 'aborted') return typeof first === 'string' ? null : first;
  // Exhausting the goal's side refutes a sealed goal at pocket cost by the probe's symmetric-edge
  // argument. Reaching the start only proves reachability: reverse costs are asymmetric, so the forward
  // search must still run to completion.
  const exhaust = runSearch(graph, goal, start, probeBlocked, stats, GOAL_EXHAUST_MAX_EXPLORED);
  if (exhaust === 'unreachable') return null;
  const full = runSearch(graph, start, goal, blocked, stats, Number.POSITIVE_INFINITY);
  return typeof full === 'string' ? null : full;
}

/**
 * The A* core over the shared per-graph scratch. `'unreachable'` is an exact answer, `'aborted'` is no
 * answer at all. Endpoint validity is the caller's contract.
 */
function runSearch(
  graph: TerrainGraph,
  start: NodeId,
  goal: NodeId,
  blocked: BlockOverlay | undefined,
  stats: SearchStats | undefined,
  maxExplored: number,
): NodeId[] | 'unreachable' | 'aborted' {
  const scratch = scratchFor(graph);
  if (scratch.query >= MAX_QUERY_GENERATION) {
    scratch.stamps.fill(0);
    scratch.query = 0;
  }
  scratch.query += 1;
  const { records, stamps, heap, steps, query } = scratch;
  heap.length = 0;
  const recordAt = (node: NodeId): NodeRecord | undefined =>
    stamps[node] === query ? records[node] : undefined;

  // Deviation is the unnormalised cross product of the node offset with the start-to-goal line, zero on
  // the line and growing with sideways drift. Exact integers over raw half-cell coordinates: each axis's
  // world scale multiplies both cross terms alike and the shared |line| factor cancels within one search,
  // so only the ordering matters and it is unchanged. Magnitudes stay near 2*span^2, exact past any map.
  const startX = graph.xOf(start);
  const startY = graph.yOf(start);
  const goalX = graph.xOf(goal);
  const goalY = graph.yOf(goal);
  const lineHX = goalX - startX;
  const lineHY = goalY - startY;
  const deviation = (node: NodeId): number =>
    Math.abs((graph.xOf(node) - startX) * lineHY - (graph.yOf(node) - startY) * lineHX);

  const startH = latticeDistanceTo(graph, goalX, goalY, start);
  const startRec: NodeRecord = {
    node: start,
    g: fx.fromInt(0),
    h: startH,
    f: startH,
    dev: 0, // the start sits on its own line
    cameFrom: null,
    open: true,
    heapIdx: 0,
  };
  records[start] = startRec;
  stamps[start] = query;
  heap.push(startRec);

  let settled = 0;
  for (;;) {
    const current = heap[0];
    if (current === undefined) return 'unreachable';
    if (settled >= maxExplored) return 'aborted';

    settled += 1;
    if (stats !== undefined) stats.explored += 1;
    if (current.node === goal) return reconstruct(recordAt, current);

    // The heuristic is admissible, so the popped minimum is settled and can be closed.
    current.open = false;
    const last = heap.pop();
    if (last !== undefined && heap.length > 0) {
      heap[0] = last;
      siftDown(heap, 0, betterRecord);
    }

    graph.stepsInto(current.node, blocked, steps);
    for (let i = 0; i < steps.length; i++) {
      const { node: next, cost } = steps.at(i);
      const tentativeG = fx.add(current.g, cost);
      const existing = recordAt(next);
      if (existing === undefined) {
        const h = latticeDistanceTo(graph, goalX, goalY, next);
        const rec: NodeRecord = {
          node: next,
          g: tentativeG,
          h,
          f: fx.add(tentativeG, h),
          dev: deviation(next),
          cameFrom: current.node,
          open: true,
          heapIdx: heap.length,
        };
        records[next] = rec;
        stamps[next] = query;
        heap.push(rec);
        siftUp(heap, rec.heapIdx, betterRecord);
      } else if (existing.open && tentativeG < existing.g) {
        // A relaxation only decreases the key, so restoring the heap invariant is a sift toward the root.
        // Closed nodes are never relaxed: under a consistent heuristic their g is already optimal.
        existing.g = tentativeG;
        existing.f = fx.add(tentativeG, existing.h);
        existing.cameFrom = current.node;
        siftUp(heap, existing.heapIdx, betterRecord);
      }
    }
  }
}

/** Walk `cameFrom` back from the goal record to the start, returning the path in start→goal order. */
function reconstruct(recordAt: (node: NodeId) => NodeRecord | undefined, goalRec: NodeRecord): NodeId[] {
  const path: NodeId[] = [goalRec.node];
  let node: NodeId | null = goalRec.cameFrom;
  while (node !== null) {
    path.push(node);
    const rec = recordAt(node);
    if (rec === undefined) throw new Error(`path reconstruction hit an undiscovered node ${node}`);
    node = rec.cameFrom;
  }
  path.reverse();
  return path;
}
