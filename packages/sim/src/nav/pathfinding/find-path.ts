/**
 * Weighted A* pathfinding over the terrain half-cell adjacency graph. Each edge costs its real world
 * length times the entered node's route weight (its walking resistance on land), and the land heuristic
 * is {@link latticeOffsetDistance} weighed as grass, lowered near roads. A route so nearly minimises
 * world distance weighed by ground. All costs are fixed-point; no float enters the search.
 *
 * Ties break on a history-independent total order, so two clients in lockstep pick byte-identical paths.
 * The line-deviation key only separates routes that already tie on `f`.
 *
 * Working storage is reused per graph, so a query allocates only the path it returns.
 */

import { type Fixed, fx, ZERO } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import {
  DEFAULT_NODE_ROUGHNESS,
  latticeOffsetDistance,
  NO_READMITTED,
  type NodeId,
  STEP_COSTS,
  STEP_ROWS,
  type TerrainGraph,
  type Traversal,
} from '../terrain/index.js';
import { heapDecrease, heapPopRoot, heapPush, heapReplaceRoot } from './open-heap.js';
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
 * `goalSliceExplored` is the goal side's share of each race round, {@link RACE_SLICE_EXPLORED} by default.
 * It moves only the settle count, never the answer: the forward search's settle order is the same however
 * it is paused, and either side's verdict is exact.
 *
 * `goalOpen` is the caller's proof that more than {@link POCKET_PROBE_MAX_EXPLORED} nodes are reachable
 * from the goal under `blocked`, so the pocket probe could not refute the goal and is skipped. Like the
 * slice it moves only the settle count, so it must be a pure function of the query's terrain and overlay.
 */
export function findPath(
  graph: TerrainGraph,
  start: NodeId,
  goal: NodeId,
  blocked?: BlockOverlay,
  stats?: SearchStats,
  traversal: Traversal = 'land',
  goalSliceExplored = RACE_SLICE_EXPLORED,
  goalOpen = false,
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
  let reverse: ResumableSearch | undefined;
  if (!goalOpen) {
    // A goal the forward search reaches, or a start region it exhausts, within the probe's own cost
    // needs no probe.
    const near = forward.advance(POCKET_PROBE_MAX_EXPLORED);
    if (near !== 'aborted') return pathOf(near);
    reverse = goalSideSearch(graph, start, goal, blocked, stats, traversal);
    const probe = reverse.advance(POCKET_PROBE_MAX_EXPLORED);
    if (probe === 'unreachable') return null;
    // Reverse costs are asymmetric, so a proved route still needs the forward search, with nothing left to
    // guard against.
    if (probe !== 'aborted') return pathOf(forward.advance(UNCAPPED));
  }
  // Pausing never changes a search's settle order, so every forward answer below is byte-identical to one
  // unguarded search, and a goal side exhausted first refutes the goal.
  const guarded = forward.advance(FLOOD_GUARD_MAX_EXPLORED);
  if (guarded !== 'aborted') return pathOf(guarded);
  reverse ??= goalSideSearch(graph, start, goal, blocked, stats, traversal);
  for (;;) {
    const goalSide = reverse.advance(
      Math.min(reverse.explored + goalSliceExplored, GOAL_EXHAUST_MAX_EXPLORED),
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
 * The goal side of {@link findPath}'s race, whose verdicts are exact for the forward search: a search
 * back from the goal with a blocked start re-admitted as its target, the mirror of the forward search's
 * step-off exemption. Every other edge is symmetric, so the side reaches the start exactly when the
 * forward search reaches the goal.
 */
function goalSideSearch(
  graph: TerrainGraph,
  start: NodeId,
  goal: NodeId,
  blocked: BlockOverlay,
  stats: SearchStats | undefined,
  traversal: Traversal,
): ResumableSearch {
  return new ResumableSearch(
    scratchFor(graph, 'reverse'),
    graph,
    goal,
    start,
    blocked,
    stats,
    traversal,
    blocked.has(start) ? start : NO_READMITTED,
  );
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

/** The lattice edges per node, the bits of a step lane. */
const EDGE_COUNT = STEP_COSTS.length;

/**
 * The land heuristic's per-length weight far from roads: common ground (grass, roughness 2), not a road's
 * 1. A deliberately inflated heuristic (weighted A*), a named approximation trading exactness for search
 * cost. Unweighted lattice distance is consistent (no step weighs under 1), so with this term alone a route
 * costs at most this factor over the cheapest even without reopening settled nodes; the average excess on
 * the six-edge lattice is unmeasured. On uniform grass it is exact.
 */
const LAND_HEURISTIC_WEIGHT = DEFAULT_NODE_ROUGHNESS;

/**
 * The inflation of the road-aware estimate `d + min(d, r)`, with `d` the lattice distance to the goal and
 * `r` to the nearest road: ground (grass, 2) up to the step onto the first road (1) makes a route cost at
 * least `d + r - 1`, and `2d` without a road. The inflated term is no scaled consistent heuristic, so the
 * grass weight's bound does not cover it, and its settles and route excess on the six-edge lattice are
 * unmeasured. Approximation: native resistance-1 ground and map-border nodes are not counted as roads.
 */
const ROAD_HEURISTIC_INFLATION = fx.div(fx.fromInt(3), fx.fromInt(2));

/** Node `(hx, hy)`'s column in quarter-column units, where an odd row's shift is a whole unit. */
function doubledColumn(hx: number, hy: number): number {
  return 2 * hx + (hy & 1);
}

/** Below every road network label, so a search's first gap read always computes. */
const NO_GAP_READ = -2;

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
  // the line and growing with sideways drift. Exact integers over doubled columns (`2*hx + (hy & 1)`,
  // the odd-row shift made integral) and half-rows: each axis's world scale multiplies both cross terms
  // alike and the shared |line| factor cancels within one search, so only the ordering matters and it is
  // unchanged. Magnitudes stay near 4*span^2, exact past any map.
  private readonly startX: number;
  private readonly startY: number;
  private readonly goalX: number;
  private readonly goalY: number;
  // The last road network's gap to the goal: fixed for the whole search, and consecutive discoveries
  // mostly share their nearest network.
  private gapNetwork = NO_GAP_READ;
  private gap: Fixed = ZERO;

  constructor(
    private readonly scratch: SearchScratch,
    private readonly graph: TerrainGraph,
    start: NodeId,
    private readonly goal: NodeId,
    blocked: BlockOverlay | undefined,
    private readonly stats: SearchStats | undefined,
    private readonly traversal: Traversal,
    readmitted: number = NO_READMITTED,
  ) {
    graph.resetGate(scratch.gate, traversal, blocked, readmitted);
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
    scratch.cameFrom[start] = NO_NODE;
    scratch.heapSize = 0;
    // The start sits on its own line.
    heapPush(scratch, start, this.heuristic(start, this.startX, this.startY), 0, 0);
  }

  /** Settle until a verdict, or return `'aborted'` once this search has settled `maxExplored` in total. */
  advance(maxExplored: number): NodeId[] | 'unreachable' | 'aborted' {
    const { scratch, graph, goal, stats, query, traversal, startX, startY } = this;
    // The heap arrays are read through `scratch`: a push may replace them with larger ones.
    const { stamps, g, cameFrom, heapIdx, gate } = scratch;
    const lane = gate.lane;
    const factors = graph.routeFactorLane(traversal);
    if (scratch.query !== query) throw new Error('a newer search on this scratch overwrote a paused one');
    const width = graph.width;
    const startD = doubledColumn(startX, startY);
    const lineD = doubledColumn(this.goalX, this.goalY) - startD;
    const lineHY = this.goalY - startY;
    for (;;) {
      if (scratch.heapSize === 0) return 'unreachable';
      // The heap holds node ids; a typed array only drops the brand.
      const current = (scratch.heap[0] ?? 0) as NodeId;
      if (this.explored >= maxExplored) return 'aborted';

      this.explored += 1;
      if (stats !== undefined) stats.explored += 1;
      if (current === goal) return reconstruct(scratch, current);

      // The popped minimum is closed for good; see LAND_HEURISTIC_WEIGHT for what that costs on land.
      heapIdx[current] = SETTLED;
      const currentG = scratch.heapG[0] ?? 0;
      // The settled root leaves the heap with the expansion's first push, one sift for both, since
      // that node often keys at the minimum; the total order makes the pop sequence the same.
      let rootLeft = false;

      const currentY = graph.yOf(current);
      const open = lane[current] ?? 0;
      const offsets = graph.stepOffsets(currentY);
      // The static lane's bits in canonical neighbour order; the gate drops the overlay's.
      for (let edge = 0; edge < EDGE_COUNT; edge++) {
        if ((open & (1 << edge)) === 0) continue;
        const next = current + (offsets[edge] ?? 0);
        if (gate.closes(next)) continue;
        const discovered = stamps[next] === query;
        // Settled nodes are never relaxed, so they skip the step's cost.
        if (discovered && heapIdx[next] === SETTLED) continue;
        const cost = (STEP_COSTS[edge] ?? 0) as Fixed;
        const tentativeG = currentG + fx.mulInt(cost, factors === undefined ? 1 : (factors[next] ?? 1));
        if (!discovered) {
          stamps[next] = query;
          g[next] = tentativeG;
          cameFrom[next] = current;
          const nextY = currentY + (STEP_ROWS[edge] ?? 0);
          const nextX = next - nextY * width;
          const dev = Math.abs((doubledColumn(nextX, nextY) - startD) * lineHY - (nextY - startY) * lineD);
          const f = tentativeG + this.heuristic(next as NodeId, nextX, nextY);
          if (rootLeft) heapPush(scratch, next as NodeId, f, tentativeG, dev);
          else heapReplaceRoot(scratch, next as NodeId, f, tentativeG, dev);
          rootLeft = true;
          continue;
        }
        // A relaxation only decreases the key, so restoring the heap invariant is a sift toward the root.
        // Water's heuristic is consistent, so a settled node's g is optimal there; on land the inflated
        // heuristic can settle a node early, a loss the two weights' notes quantify.
        const knownG = g[next] ?? 0;
        if (tentativeG >= knownG) continue;
        if (!rootLeft) {
          heapPopRoot(scratch);
          rootLeft = true;
        }
        // Read after the root left, which moves slots.
        const index = heapIdx[next] ?? SETTLED;
        heapDecrease(scratch, index, tentativeG + ((scratch.heapF[index] ?? 0) - knownG), tentativeG);
        g[next] = tentativeG;
        cameFrom[next] = current;
      }
      if (!rootLeft) heapPopRoot(scratch);
    }
  }

  /**
   * Ships sail by plain lattice distance; land weighs it as grass, lowered near a road by
   * {@link ROAD_HEURISTIC_INFLATION}'s road-aware bound. That bound never drops under `d + r + g`, with
   * `g` the goal's distance to the bounding box of the network holding the nearest road: a route over
   * that network still crosses `g` of ground to the goal. Without it a road node reads 1.5d however far
   * its network lies, and a search between towns no road joins floods each town's streets.
   */
  private heuristic(node: NodeId, x: number, y: number): Fixed {
    const toGoal = latticeOffsetDistance(this.goalX - x, this.goalY - y, y);
    if (this.traversal !== 'land') return toGoal;
    const overGrass = fx.mulInt(toGoal, LAND_HEURISTIC_WEIGHT);
    const toRoad = this.graph.roadDistanceAt(node);
    if (toRoad >= toGoal) return overGrass;
    const network = this.graph.roadNetworkNear(node);
    if (network !== this.gapNetwork) {
      this.gapNetwork = network;
      this.gap = this.graph.roadNetworkGap(network, this.goalX, this.goalY);
    }
    const nearRoad = fx.add(toGoal, toRoad);
    const inflated = fx.mul(nearRoad, ROAD_HEURISTIC_INFLATION);
    const bounded = fx.add(nearRoad, this.gap);
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
