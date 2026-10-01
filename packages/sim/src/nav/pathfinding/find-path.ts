/**
 * Weighted A* pathfinding over the terrain half-cell adjacency graph. Each edge costs its real world
 * length times the entered node's route weight (its walking resistance on land), and the land heuristic
 * is {@link latticeDistanceTo} weighed as grass, lowered near roads. A route so nearly minimises on-screen
 * distance weighed by ground, reading straight under the staggered raster on even ground. All
 * costs are fixed-point; no float enters the search.
 *
 * Ties break on a history-independent total order, so two clients in lockstep pick byte-identical paths.
 * The line-deviation key only separates routes that already tie on `f`.
 *
 * Working storage is reused per graph, so a query allocates only the path it returns.
 */

import { type Fixed, fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import {
  DEFAULT_NODE_ROUGHNESS,
  latticeDistanceTo,
  type NodeId,
  type TerrainGraph,
  type Traversal,
} from '../terrain/index.js';
import { siftDown, siftUp } from './open-heap.js';
import { MAX_QUERY_GENERATION, NO_NODE, SETTLED, type SearchScratch, scratchFor } from './scratch.js';

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
 * {@link findPath} suspects a pocket that outgrew {@link POCKET_PROBE_MAX_EXPLORED} and resumes the goal-side
 * probe beside the paused forward search rather than flooding the walker's whole region alone.
 * Observation: refuting a sealed goal forward costs orders of magnitude more settles than exhausting the
 * pocket in reverse. Authored: a performance knob sized above routine long routes; the answer never
 * changes.
 */
export const FLOOD_GUARD_MAX_EXPLORED = 4096;

/**
 * The goal-side exhaust's own settle cap, the probe's settles included. Past it the goal-side search
 * stops and the forward search runs on alone, bounding what the exhaust can lose when both sides are huge.
 */
export const GOAL_EXHAUST_MAX_EXPLORED = 32768;

/**
 * Settles each side of the race past the flood guard takes before handing over, so neither can outrun
 * the other by more. Equal slices bound either verdict at about twice its own cost: a sealed pocket costs
 * its size again in forward settles, a long open route its remainder again in goal-side settles.
 * Authored: large enough that switching costs nothing, small against the guard.
 */
export const RACE_SLICE_EXPLORED = 256;

/**
 * Find the lowest-cost path from `start` to `goal` on the half-cell graph for a mover of `traversal`
 * (land unless told otherwise), inclusive of both endpoints. Returns `null` when no route exists or
 * either endpoint is closed to the mover. `start === goal` yields the single-node path `[start]`.
 *
 * `blocked` is the dynamic walk-block overlay applied on top of static terrain walkability: a blocked node
 * is never entered, the goal included, but a blocked start is exempt so an entity standing where a
 * foundation just appeared can step off the footprint. It can never step back in.
 *
 * `stats` accumulates settled nodes, including the goal-side search's; the early-out answers settle nothing.
 */
export function findPath(
  graph: TerrainGraph,
  start: NodeId,
  goal: NodeId,
  blocked?: BlockOverlay,
  stats?: SearchStats,
  traversal: Traversal = 'land',
): NodeId[] | null {
  if (!graph.traversable(start, traversal) || !graph.traversable(goal, traversal)) return null;
  // Already-there wins over the overlay, consistent with the blocked-start exemption.
  if (start === goal) return [start];
  if (blocked?.has(goal)) return null;
  // `blocked` only removes edges, so endpoints in different static components are provably unreachable.
  // Sharing a component proves nothing, since the overlay may still wall the goal off.
  if (graph.componentOf(start) !== graph.componentOf(goal)) return null;
  const forward = new ResumableSearch(
    scratchFor(graph, 'forward'),
    graph,
    start,
    goal,
    blocked,
    stats,
    traversal,
  );
  // Without an overlay a shared static component means reachable, so the search can never flood.
  if (blocked === undefined || blocked.size === 0) return pathOf(forward.advance(UNCAPPED));
  // The reverse probe re-admits a blocked start as its target: forward, the walker may leave that node but
  // never re-enter it, which in reverse is exactly "enterable as the final step only", so both directions
  // see the same edge set and the probe's "unreachable" stays exact.
  const probeBlocked: BlockOverlay = blocked.has(start)
    ? { has: (n) => n !== start && blocked.has(n), size: blocked.size }
    : blocked;
  const reverse = new ResumableSearch(
    scratchFor(graph, 'reverse'),
    graph,
    goal,
    start,
    probeBlocked,
    stats,
    traversal,
  );
  const probe = reverse.advance(POCKET_PROBE_MAX_EXPLORED);
  if (probe === 'unreachable') return null;
  // Reaching the start only proves reachability: reverse costs are asymmetric, so the forward search still
  // runs, with nothing left to guard against.
  if (probe !== 'aborted') return pathOf(forward.advance(UNCAPPED));
  // Pausing never changes a search's settle order, so every forward answer below is byte-identical to one
  // unguarded search, and a goal side exhausted first refutes the goal by the probe's symmetric-edge
  // argument.
  const guarded = forward.advance(FLOOD_GUARD_MAX_EXPLORED);
  if (guarded !== 'aborted') return pathOf(guarded);
  for (;;) {
    const goalSide = reverse.advance(
      Math.min(reverse.explored + RACE_SLICE_EXPLORED, GOAL_EXHAUST_MAX_EXPLORED),
    );
    if (goalSide === 'unreachable') return null;
    if (goalSide !== 'aborted' || reverse.explored >= GOAL_EXHAUST_MAX_EXPLORED) {
      return pathOf(forward.advance(UNCAPPED));
    }
    const ahead = forward.advance(forward.explored + RACE_SLICE_EXPLORED);
    if (ahead !== 'aborted') return pathOf(ahead);
  }
}

/**
 * One capped forward A* with no pocket probe: `'unreachable'` is exact, `'aborted'` means the cap ran out
 * first. For short searches that fall back to {@link findPath} on anything but a route.
 */
export function findPathWithin(
  graph: TerrainGraph,
  start: NodeId,
  goal: NodeId,
  blocked: BlockOverlay,
  stats: SearchStats,
  maxExplored: number,
  traversal: Traversal = 'land',
): NodeId[] | 'unreachable' | 'aborted' {
  if (!graph.traversable(start, traversal) || !graph.traversable(goal, traversal) || blocked.has(goal)) {
    return 'unreachable';
  }
  if (start === goal) return [start];
  if (graph.componentOf(start) !== graph.componentOf(goal)) return 'unreachable';
  return new ResumableSearch(
    scratchFor(graph, 'forward'),
    graph,
    start,
    goal,
    blocked,
    stats,
    traversal,
  ).advance(maxExplored);
}

const UNCAPPED = Number.POSITIVE_INFINITY;

/**
 * The land heuristic's per-length weight far from roads: common ground (grass, roughness 2), not a road's
 * 1. A deliberately inflated heuristic (weighted A*), a named approximation trading exactness for search
 * cost: scaled by the least weight, a long route on magiczny_las settled about 40k nodes. Unweighted
 * lattice distance is consistent (no step weighs under 1), so with this term alone a route costs at most
 * this factor over the cheapest even without reopening settled nodes; measured there, 0.3 to 1.2% over on
 * average. On uniform grass it is exact.
 */
const LAND_HEURISTIC_WEIGHT = fx.fromInt(DEFAULT_NODE_ROUGHNESS);

/**
 * The inflation of the road-aware estimate `d + min(d, r)`, with `d` the lattice distance to the goal and
 * `r` to the nearest road: ground (grass, 2) up to the step onto the first road (1) makes a route cost at
 * least `d + r - 1`, and `2d` without a road. The inflated term is no scaled consistent heuristic, so the
 * grass weight's bound does not cover it; its cost is measured. On magiczny_las with town streets laid:
 * uninflated, searches in and into a town settled 6 to 11 times what the grass weight does; at 3/2, 1.2 to
 * 1.4 times, routes cost 1.9 to 2.7% over the cheapest on average, and 93 to 98% of the routes a road
 * shortens by 2% take it (the grass weight alone: 61 to 90%). Approximation: native resistance-1 ground
 * and map-border nodes are not counted as roads.
 */
const ROAD_HEURISTIC_INFLATION = fx.div(fx.fromInt(3), fx.fromInt(2));

function pathOf(verdict: NodeId[] | 'unreachable' | 'aborted'): NodeId[] | null {
  return typeof verdict === 'string' ? null : verdict;
}

/**
 * The A* core over one per-graph scratch, pausable between settles. Starting one claims its scratch, so a
 * paused search stays resumable only until the next search on the same side begins. `'unreachable'` is an
 * exact answer, `'aborted'` is no answer yet. Endpoint validity is the caller's contract.
 */
class ResumableSearch {
  /** Nodes this search has settled so far. */
  explored = 0;
  private readonly query: number;
  // Deviation is the unnormalised cross product of the node offset with the start-to-goal line, zero on
  // the line and growing with sideways drift. Exact integers over raw half-cell coordinates: each axis's
  // world scale multiplies both cross terms alike and the shared |line| factor cancels within one search,
  // so only the ordering matters and it is unchanged. Magnitudes stay near 2*span^2, exact past any map.
  private readonly startX: number;
  private readonly startY: number;
  private readonly goalX: number;
  private readonly goalY: number;

  constructor(
    private readonly scratch: SearchScratch,
    private readonly graph: TerrainGraph,
    start: NodeId,
    private readonly goal: NodeId,
    private readonly blocked: BlockOverlay | undefined,
    private readonly stats: SearchStats | undefined,
    private readonly traversal: Traversal,
  ) {
    if (scratch.query >= MAX_QUERY_GENERATION) {
      scratch.stamps.fill(0);
      scratch.query = 0;
    }
    scratch.query += 1;
    this.query = scratch.query;
    this.startX = graph.xOf(start);
    this.startY = graph.yOf(start);
    this.goalX = graph.xOf(goal);
    this.goalY = graph.yOf(goal);
    scratch.stamps[start] = this.query;
    scratch.g[start] = 0;
    scratch.f[start] = this.heuristic(start);
    scratch.dev[start] = 0; // the start sits on its own line
    scratch.cameFrom[start] = NO_NODE;
    scratch.heapIdx[start] = 0;
    scratch.heap[0] = start;
    scratch.heapSize = 1;
  }

  /** Settle until a verdict, or return `'aborted'` once this search has settled `maxExplored` in total. */
  advance(maxExplored: number): NodeId[] | 'unreachable' | 'aborted' {
    const { scratch, graph, goal, blocked, stats, query, traversal } = this;
    const { stamps, g, f, dev, cameFrom, heapIdx, heap, steps } = scratch;
    if (scratch.query !== query) throw new Error('a newer search on this scratch overwrote a paused one');
    const lineHX = this.goalX - this.startX;
    const lineHY = this.goalY - this.startY;
    for (;;) {
      if (scratch.heapSize === 0) return 'unreachable';
      // The heap holds node ids; a typed array only drops the brand.
      const current = (heap[0] ?? 0) as NodeId;
      if (this.explored >= maxExplored) return 'aborted';

      this.explored += 1;
      if (stats !== undefined) stats.explored += 1;
      if (current === goal) return reconstruct(scratch, current);

      // The popped minimum is closed for good; see LAND_HEURISTIC_WEIGHT for what that costs on land.
      heapIdx[current] = SETTLED;
      scratch.heapSize -= 1;
      if (scratch.heapSize > 0) {
        heap[0] = heap[scratch.heapSize] ?? 0;
        siftDown(scratch, 0);
      }

      const currentG = g[current] ?? 0;
      graph.stepsInto(current, blocked, steps, traversal);
      for (let i = 0; i < steps.length; i++) {
        const next = steps.nodeAt(i);
        const discovered = stamps[next] === query;
        // Settled nodes are never relaxed, so they skip the step's cost.
        if (discovered && heapIdx[next] === SETTLED) continue;
        const tentativeG = currentG + fx.mul(steps.costAt(i), graph.routeWeightAt(next, traversal));
        if (!discovered) {
          stamps[next] = query;
          g[next] = tentativeG;
          f[next] = tentativeG + this.heuristic(next);
          dev[next] = Math.abs(
            (graph.xOf(next) - this.startX) * lineHY - (graph.yOf(next) - this.startY) * lineHX,
          );
          cameFrom[next] = current;
          heap[scratch.heapSize] = next;
          scratch.heapSize += 1;
          siftUp(scratch, scratch.heapSize - 1);
          continue;
        }
        // A relaxation only decreases the key, so restoring the heap invariant is a sift toward the root.
        // Water's heuristic is consistent, so a settled node's g is optimal there; on land the inflated
        // heuristic can settle a node early, a loss the two weights' notes quantify.
        const index = heapIdx[next] ?? SETTLED;
        const knownG = g[next] ?? 0;
        if (tentativeG >= knownG) continue;
        f[next] = tentativeG + ((f[next] ?? 0) - knownG);
        g[next] = tentativeG;
        cameFrom[next] = current;
        siftUp(scratch, index);
      }
    }
  }

  /**
   * Ships sail by plain lattice distance; land weighs it as grass, lowered near a road by
   * {@link ROAD_HEURISTIC_INFLATION}'s road-aware bound. That bound never drops under `d + r + g`, with
   * `g` the goal's distance to the bounding box of the network holding the nearest road: a route over
   * that network still crosses `g` of ground to the goal. Without it a road node reads 1.5d however far
   * its network lies, and a search between towns no road joins floods each town's streets. Measured on
   * 150 routes between magiczny_las towns: 43% fewer settles, and 4.3% over the cheapest route, not 3.2%.
   */
  private heuristic(node: NodeId): Fixed {
    const toGoal = latticeDistanceTo(this.graph, this.goalX, this.goalY, node);
    if (this.traversal !== 'land') return toGoal;
    const overGrass = fx.mul(toGoal, LAND_HEURISTIC_WEIGHT);
    const toRoad = this.graph.roadDistanceAt(node);
    if (toRoad >= toGoal) return overGrass;
    const network = this.graph.roadNetworkNear(node);
    const nearRoad = fx.add(toGoal, toRoad);
    const inflated = fx.mul(nearRoad, ROAD_HEURISTIC_INFLATION);
    const bounded = fx.add(nearRoad, this.graph.roadNetworkGap(network, this.goalX, this.goalY));
    const viaRoad = inflated > bounded ? inflated : bounded;
    return viaRoad < overGrass ? viaRoad : overGrass;
  }
}

/** Walk `cameFrom` back from the goal to the start, returning the path in start→goal order. `cameFrom`
 *  holds only node ids or {@link NO_NODE}. */
function reconstruct(scratch: SearchScratch, goal: NodeId): NodeId[] {
  const { stamps, cameFrom, query } = scratch;
  const path: NodeId[] = [goal];
  let node = cameFrom[goal] ?? NO_NODE;
  while (node !== NO_NODE) {
    if (stamps[node] !== query) throw new Error(`path reconstruction hit an undiscovered node ${node}`);
    path.push(node as NodeId);
    node = cameFrom[node] ?? NO_NODE;
  }
  path.reverse();
  return path;
}
