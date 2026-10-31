import { type Fixed, fx, ULP, ZERO } from '../../core/fixed.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import {
  doubledColumnDistance,
  NO_COMPONENT,
  type NodeId,
  StepBuffer,
  slantDx,
  type TerrainGraph,
} from '../../nav/terrain/index.js';
import { HALF_COLUMN, QUARTER_COLUMN, ROW_EDGE } from '../../nav/world-metric.js';
import { firstRingNode } from '../ai-shared/node-geometry.js';
import { WalkBlockMask } from '../footprint/walk-block-mask.js';

/** Walking costs from a seed set over the pathfinder's own edges, in the tile units their lengths carry
 *  (a half column is half a tile, a row-crossing edge about three eighths; ground is not weighed): a spot search
 *  ranks candidates by the trip a man walks round what blocks him, not as the crow flies. */
export interface WalkDistances {
  /** The cheapest walk from a seed to `node`, or undefined off the seeds' ground or past the flood budget. */
  costTo(node: NodeId): Fixed | undefined;
  /** A floor under what {@link costTo} answers for `node`, read without flooding on: its cost once settled,
   *  else the least cost still waiting to settle; undefined once no node can settle any more. */
  costFloor(node: NodeId): Fixed | undefined;
}

/** The entries a fresh {@link WalkFrontier} holds room for before it first grows. */
const FRONTIER_INITIAL_CAPACITY = 256;

/** A binary min-heap of (cost, node), ties by node id, so the settle order is byte-identical. Held in
 *  typed slots that double when full, so a push or pop allocates nothing. */
class WalkFrontier<N extends number = NodeId> {
  private costs = new Float64Array(FRONTIER_INITIAL_CAPACITY);
  private nodes = new Int32Array(FRONTIER_INITIAL_CAPACITY);
  size = 0;

  /** The least entry's cost, which no later pop undercuts; undefined while empty. */
  peekCost(): Fixed | undefined {
    return this.size === 0 ? undefined : (this.costs[0] as Fixed | undefined);
  }

  push(cost: Fixed, node: N): void {
    if (this.size === this.nodes.length) this.grow();
    const { costs, nodes } = this;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentCost = costs[parent] ?? 0;
      const parentNode = nodes[parent] ?? 0;
      if (parentCost < cost || (parentCost === cost && parentNode <= node)) break;
      costs[i] = parentCost;
      nodes[i] = parentNode;
      i = parent;
    }
    costs[i] = cost;
    nodes[i] = node;
  }

  /** The cost of the entry the last {@link pop} returned. */
  poppedCost: Fixed = fx.fromInt(0);

  /** The least entry's node; its cost lands in {@link poppedCost}, so a settle allocates nothing. */
  pop(): N {
    if (this.size === 0) throw new Error('pop on an empty frontier');
    const { costs, nodes } = this;
    const top = (nodes[0] ?? 0) as N;
    this.poppedCost = (costs[0] ?? 0) as Fixed;
    const size = --this.size;
    if (size > 0) {
      const cost = costs[size] ?? 0;
      const node = nodes[size] ?? 0;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= size) break;
        const right = left + 1;
        let least = left;
        let leastCost = costs[left] ?? 0;
        let leastNode = nodes[left] ?? 0;
        if (right < size) {
          const rightCost = costs[right] ?? 0;
          const rightNode = nodes[right] ?? 0;
          if (rightCost < leastCost || (rightCost === leastCost && rightNode < leastNode)) {
            least = right;
            leastCost = rightCost;
            leastNode = rightNode;
          }
        }
        if (cost < leastCost || (cost === leastCost && node <= leastNode)) break;
        costs[i] = leastCost;
        nodes[i] = leastNode;
        i = least;
      }
      costs[i] = cost;
      nodes[i] = node;
    }
    return top;
  }

  private grow(): void {
    const costs = new Float64Array(this.costs.length * 2);
    const nodes = new Int32Array(this.nodes.length * 2);
    costs.set(this.costs);
    nodes.set(this.nodes);
    this.costs = costs;
    this.nodes = nodes;
  }
}

const COST_PAGE_SHIFT = 7;
const COST_PAGE_SIZE = 1 << COST_PAGE_SHIFT;
const COST_PAGE_MASK = COST_PAGE_SIZE - 1;
/** A page slot no walk has reached yet: past every cost, so no relaxation ever keeps it. */
const UNREACHED_COST = Number.POSITIVE_INFINITY;

/** A settled slot holds `-(cost + 1)`: below zero, where no reached cost lies, so one read tells settled,
 *  reached and unreached apart. */
function settledSlot(cost: Fixed): number {
  return -cost - 1;
}

function slotCost(slot: number): Fixed {
  return (-slot - 1) as Fixed;
}

/** Pages are allocated only where this bounded flood visits. Indexed costs avoid a pair of per-node
 * Maps without allocating full-map buffers for each resource's small flood. The page directory is a
 * dense window over the page indices visited, offset by its first one: a plain array stored at an index
 * far past its length drops into V8's slow dictionary elements, which every relaxation would then pay. */
class WalkCosts {
  private pages: Array<Float64Array | undefined> = [];
  /** The page index `pages[0]` holds. */
  private firstPage = 0;
  settledCount = 0;

  /** The page holding `node`'s slot at `node & COST_PAGE_MASK`: its best cost so far, {@link settledSlot}
   *  once settled. */
  page(node: NodeId): Float64Array {
    const index = node >> COST_PAGE_SHIFT;
    const known = this.pageAt(index);
    if (known !== undefined) return known;
    const page = new Float64Array(COST_PAGE_SIZE).fill(UNREACHED_COST);
    this.cover(index);
    this.pages[index - this.firstPage] = page;
    return page;
  }

  settledCost(node: NodeId): Fixed | undefined {
    const slot = this.pageAt(node >> COST_PAGE_SHIFT)?.[node & COST_PAGE_MASK];
    return slot !== undefined && slot < 0 ? slotCost(slot) : undefined;
  }

  private pageAt(index: number): Float64Array | undefined {
    const at = index - this.firstPage;
    return at >= 0 && at < this.pages.length ? this.pages[at] : undefined;
  }

  /** Widen the directory to hold `index`, doubling its span toward the side it grows on so a walk
   *  spreading row by row re-copies it only a logarithmic number of times. */
  private cover(index: number): void {
    const { pages, firstPage } = this;
    const span = pages.length;
    if (span === 0) {
      this.firstPage = index;
      this.pages = [undefined];
      return;
    }
    if (index >= firstPage && index < firstPage + span) return;
    const grown = Math.max(span, index < firstPage ? firstPage - index : index - (firstPage + span) + 1);
    const first = index < firstPage ? Math.max(0, firstPage - 2 * grown) : firstPage;
    const end = index < firstPage ? firstPage + span : firstPage + span + 2 * grown;
    const widened = new Array<Float64Array | undefined>(end - first).fill(undefined);
    for (let i = 0; i < span; i++) widened[firstPage - first + i] = pages[i];
    this.pages = widened;
    this.firstPage = first;
  }
}

/** `blocked` as one search pass reads it: the walk-block mask levelled once, since nothing writes the
 *  world while a pass runs, so the pass skips the per-read level check. */
function passOverlay(blocked: BlockOverlay): BlockOverlay {
  return blocked instanceof WalkBlockMask ? blocked.levelled() : blocked;
}

/**
 * Dijkstra from `seeds` over the walkable nodes the `blocked` overlay leaves, run lazily: a query floods
 * on only until its node settles, so a near candidate costs a small disc and only an unreachable one
 * spends the whole `budget` (authored cap), after which every unsettled node reads unreached. The settle
 * order never depends on the queries, so the costs are byte-identical whatever is asked first. A seed's
 * own ground is not checked: {@link walkSeedNear} finds a walkable one.
 */
export class WalkFlood implements WalkDistances {
  private readonly costs = new WalkCosts();
  private readonly frontier = new WalkFrontier();
  private readonly steps = new StepBuffer();
  /** The box of the settled nodes, whose steps are the only overlay reads the flood has made. */
  private settledBox = {
    minHx: Number.POSITIVE_INFINITY,
    maxHx: -1,
    minHy: Number.POSITIVE_INFINITY,
    maxHy: -1,
  };

  constructor(
    private readonly terrain: TerrainGraph,
    private readonly blocked: BlockOverlay,
    seeds: readonly NodeId[],
    private readonly budget: number,
  ) {
    for (const seed of seeds) this.frontier.push(ZERO, seed);
  }

  /** The mask and version a holder handed this flood out at, or null for a flood nobody holds. */
  private heldAt: {
    readonly mask: WalkBlockMask;
    readonly version: number;
  } | null = null;

  /**
   * Bind the flood to `mask` at `version` for one pass of asks: a holder resumes it on later passes only
   * after proving its reads, so every ask of this pass must see the mask unchanged, or a resumed flood
   * would answer from reads a fresh one would make anew.
   */
  holdAt(mask: WalkBlockMask, version: number): void {
    this.heldAt = { mask, version };
  }

  private assertHeldCurrent(): void {
    const held = this.heldAt;
    // The version counts the mask's levellings, flip or none, so a write that moved no node trips it too.
    if (held !== null && held.mask.version !== held.version) {
      throw new Error('a held walk flood was asked after the walk-block mask changed within its pass');
    }
  }

  costFloor(node: NodeId): Fixed | undefined {
    this.assertHeldCurrent();
    const known = this.costs.settledCost(node);
    if (known !== undefined) return known;
    // Every walk to an unsettled node leaves through the frontier, so it costs at least the frontier's least.
    return this.costs.settledCount < this.budget ? this.frontier.peekCost() : undefined;
  }

  costTo(node: NodeId): Fixed | undefined {
    return this.settleTo(node, null);
  }

  /** {@link costTo} for a caller that only needs to know whether the walk costs at most `cap`: the flood
   *  stops once every walk still open costs more, and `node` then reads undefined. */
  costWithin(node: NodeId, cap: Fixed): Fixed | undefined {
    const cost = this.settleTo(node, cap);
    return cost !== undefined && cost <= cap ? cost : undefined;
  }

  private settleTo(node: NodeId, cap: Fixed | null): Fixed | undefined {
    this.assertHeldCurrent();
    const known = this.costs.settledCost(node);
    if (known !== undefined) return known;
    const { costs, frontier, steps, terrain } = this;
    const blocked = passOverlay(this.blocked);
    while (frontier.size > 0 && costs.settledCount < this.budget) {
      // The frontier's least cost floors every walk not yet settled, stale entries included.
      if (cap !== null && (frontier.peekCost() ?? cap) > cap) return undefined;
      const next = frontier.pop();
      const cost = frontier.poppedCost;
      const page = costs.page(next);
      const at = next & COST_PAGE_MASK;
      if ((page[at] ?? UNREACHED_COST) < 0) continue;
      page[at] = settledSlot(cost);
      costs.settledCount++;
      this.boxSettled(next);
      terrain.stepsInto(next, blocked, steps);
      for (let i = 0; i < steps.length; i++) {
        const stepNode = steps.nodeAt(i);
        const candidate = costs.page(stepNode);
        const offset = stepNode & COST_PAGE_MASK;
        const held = candidate[offset] ?? UNREACHED_COST;
        if (held < 0) continue;
        const stepCost = fx.add(cost, steps.costAt(i));
        if (held <= stepCost) continue;
        candidate[offset] = stepCost;
        frontier.push(stepCost, stepNode);
      }
      if (next === node) return cost;
    }
    return undefined;
  }

  /**
   * Whether every overlay answer this flood has read still holds on `mask`, which it last read at version
   * `since`: no walkable node within a step's reach of a settled node flipped since. Then the flood is the
   * one a fresh flood would grow into, settle for settle, and may be resumed.
   */
  readsHoldOn(mask: WalkBlockMask, since: number): boolean {
    const box = this.settledBox;
    if (box.maxHx < 0) return true;
    const read = {
      minHx: box.minHx - STEP_REACH_X,
      maxHx: box.maxHx + STEP_REACH_X,
      minHy: box.minHy - STEP_REACH_Y,
      maxHy: box.maxHy + STEP_REACH_Y,
    };
    return !mask.flippedSince(read, since, (x, y) => this.settledNear(x, y));
  }

  /** Whether a settled node lies within a step's reach of `(x, y)`, so the flood read that node. */
  private settledNear(x: number, y: number): boolean {
    const terrain = this.terrain;
    for (let dy = -STEP_REACH_Y; dy <= STEP_REACH_Y; dy++) {
      for (let dx = -STEP_REACH_X; dx <= STEP_REACH_X; dx++) {
        if (!terrain.inBounds(x + dx, y + dy)) continue;
        if (this.costs.settledCost(terrain.nodeAt(x + dx, y + dy)) !== undefined) return true;
      }
    }
    return false;
  }

  private boxSettled(node: NodeId): void {
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    const box = this.settledBox;
    if (x < box.minHx) box.minHx = x;
    if (x > box.maxHx) box.maxHx = x;
    if (y < box.minHy) box.minHy = y;
    if (y > box.maxHy) box.maxHy = y;
  }
}

/** How far from a node the lattice's steps out of it read the overlay: one node either way. */
const STEP_REACH_X = 1;
const STEP_REACH_Y = 1;

/** What a row-crossing edge costs beyond the quarter column of sideways ground it covers. */
const ROW_EDGE_OVER_QUARTER: Fixed = fx.sub(ROW_EDGE, QUARTER_COLUMN);

/** A lower bound on any walk from node `(ax, ay)` to node `(bx, by)`: the open-lattice distance, a
 *  metric over doubled columns that no single step undercuts, so it never overestimates and falls by at
 *  most a step's cost per step: a consistent A* heuristic. */
export function walkLowerBound(ax: number, ay: number, bx: number, by: number): Fixed {
  return doubledColumnDistance(2 * (bx - ax) + (by & 1) - (ay & 1), by - ay);
}

type OpenStep = readonly [dx: number, dy: number, cost: Fixed];

/** The unobstructed lattice's step offsets and costs from a row whose slants shift `slant` columns:
 *  {@link TerrainGraph.stepsInto}'s edge set on open ground, where every edge is open. */
function openSteps(slant: number): readonly OpenStep[] {
  return [
    [1, 0, HALF_COLUMN],
    [0, 1, ROW_EDGE],
    [slant, 1, ROW_EDGE],
    [-1, 0, HALF_COLUMN],
    [slant, -1, ROW_EDGE],
    [0, -1, ROW_EDGE],
  ];
}
/** Any even and any odd row: only the parity matters. */
const EVEN_ROW = 0;
const ODD_ROW = 1;
const OPEN_STEPS_EVEN = openSteps(slantDx(EVEN_ROW));
const OPEN_STEPS_ODD = openSteps(slantDx(ODD_ROW));
/** Packs an unobstructed lattice offset into one key; offsets stay far inside the span for any budget a
 *  map flood uses. */
const OPEN_LATTICE_SPAN = 1 << 13;
const OPEN_LATTICE_CENTRE = OPEN_LATTICE_SPAN >> 1;

const certainBelowByBudget = new Map<number, Fixed>();

/**
 * The walk cost under which a node always ranks within the first `budget` a {@link WalkFlood} settles:
 * the cost of the `budget + 1`-th node an open, unbounded lattice settles. A walk never undercuts the
 * open lattice's, so every node settled before one cheaper than this is one of those `budget`. The
 * lattice from an odd row is the even row's mirror image, so one origin (on an even row) settles the
 * same cost sequence for both.
 */
export function budgetCertainBelow(budget: number): Fixed {
  const known = certainBelowByBudget.get(budget);
  if (known !== undefined) return known;
  const frontier = new WalkFrontier<number>();
  const best = new Map<number, Fixed>();
  const settled = new Set<number>();
  const origin = OPEN_LATTICE_CENTRE * OPEN_LATTICE_SPAN + OPEN_LATTICE_CENTRE;
  frontier.push(ZERO, origin);
  let certain: Fixed = ZERO;
  while (frontier.size > 0) {
    const key = frontier.pop();
    if (settled.has(key)) continue;
    certain = frontier.poppedCost;
    if (settled.size === budget) break;
    settled.add(key);
    const x = Math.floor(key / OPEN_LATTICE_SPAN);
    const y = key % OPEN_LATTICE_SPAN;
    const steps = (y & 1) === 0 ? OPEN_STEPS_EVEN : OPEN_STEPS_ODD;
    for (const [dx, dy, cost] of steps) {
      const next = (x + dx) * OPEN_LATTICE_SPAN + (y + dy);
      if (settled.has(next)) continue;
      const stepCost = fx.add(certain, cost);
      const held = best.get(next);
      if (held !== undefined && held <= stepCost) continue;
      best.set(next, stepCost);
      frontier.push(stepCost, next);
    }
  }
  certainBelowByBudget.set(budget, certain);
  return certain;
}

/** What a {@link SeedWalks} answers. `flood`: exactly what one lazy {@link WalkFlood} of the budget from
 *  the seed would. `aimed`: each aimed walk's own true cost, a node it has not settled once it has
 *  settled the budget counting as unreached. */
export type SeedWalkAnswers = 'flood' | 'aimed';

/**
 * Every walk out of one seed under one overlay state. Walks aimed at a target ({@link DirectedWalk})
 * settle a corridor. Answering as the `flood`, the flood runs only for an answer they cannot prove: a
 * node settled at its true cost is one the flood reaches when no more than `budget` nodes can settle
 * first, its cost under {@link budgetCertainBelow} or the open nodes within the lower bound's reach of
 * that cost no more.
 */
export class SeedWalks {
  private flood: WalkFlood | null = null;
  private readonly aimed = new Map<string, WalkDistances>();
  readonly component: number;
  /** Costs proved inside the budget up to this one, inclusive, and the least the count could not prove. */
  private certainUpTo: Fixed;
  private doubtFrom: Fixed | null = null;

  constructor(
    readonly terrain: TerrainGraph,
    readonly blocked: BlockOverlay,
    readonly seed: NodeId,
    readonly budget: number,
    private readonly answers: SeedWalkAnswers,
    /** Where the seed's flood comes from: a fresh one unless a holder resumes one it kept. */
    private readonly floodOf: (seed: NodeId, budget: number) => WalkFlood = (from, budget) =>
      new WalkFlood(terrain, blocked, [from], budget),
  ) {
    this.component = terrain.componentOf(seed);
    this.certainUpTo = fx.sub(budgetCertainBelow(budget), ULP);
  }

  /** The walk that answers for nodes within `reach` Manhattan nodes of `toward`: the flood itself once it
   *  runs, since it then already holds the walks a later search asks, and the flood's answers alone when
   *  no cost there could be proved inside the budget, so no aimed search runs only to hand over to it. */
  toward(toward: HalfCellNode, reach: number): WalkDistances {
    if (this.flood !== null) return this.flood;
    const key = `${toward.hx},${toward.hy}:${reach}`;
    let walk = this.aimed.get(key);
    if (walk === undefined) {
      walk =
        this.answers === 'aimed' || this.mayProveNear(toward, reach)
          ? new DirectedWalk(this, toward, reach)
          : new FloodAnswers(this);
      this.aimed.set(key, walk);
    }
    return walk;
  }

  /** Whether some node within `reach` of `toward` could cost little enough to prove inside the budget. */
  private mayProveNear(toward: HalfCellNode, reach: number): boolean {
    const { terrain, seed } = this;
    const least = fx.sub(
      walkLowerBound(terrain.xOf(seed), terrain.yOf(seed), toward.hx, toward.hy),
      reachSlack(reach),
    );
    return this.ranksWithin(least > ZERO ? least : ZERO);
  }

  /** {@link WalkFlood.costFloor} of the flood, or no floor above zero before it runs. */
  floodCostFloor(node: NodeId): Fixed | undefined {
    return this.flood === null ? ZERO : this.flood.costFloor(node);
  }

  /** The answer for `node`, which an aimed walk settled at `cost`. */
  settledAnswer(node: NodeId, cost: Fixed): Fixed | undefined {
    return this.answers === 'aimed' || this.ranksWithin(cost) ? cost : this.floodCostTo(node);
  }

  /** The answer for `node` once an aimed walk has settled the budget without reaching it. */
  cappedAnswer(node: NodeId): Fixed | undefined {
    return this.answers === 'aimed' ? undefined : this.floodCostTo(node);
  }

  /** The flood's own answer for `node`, flooding as far as it takes. */
  floodCostTo(node: NodeId): Fixed | undefined {
    this.flood ??= this.floodOf(this.seed, this.budget);
    return this.flood.costTo(node);
  }

  /** Whether a node settled at `cost` provably ranks within the flood's budget. The count only grows
   *  with the cost, so the proved and refused extremes answer the costs either side of them. */
  ranksWithin(cost: Fixed): boolean {
    if (cost <= this.certainUpTo) return true;
    if (this.doubtFrom !== null && cost >= this.doubtFrom) return false;
    if (this.openNodesWithin(cost) <= this.budget) {
      this.certainUpTo = cost;
      return true;
    }
    this.doubtFrom = cost;
    return false;
  }

  /** The walkable unblocked nodes on the seed's component, and the seed, whose lower bound from the seed
   *  is at most `cost`: every node the flood can settle before one of that cost. Stops counting past the
   *  budget. */
  private openNodesWithin(cost: Fixed): number {
    const { terrain, blocked, seed, budget, component } = this;
    const seedX = terrain.xOf(seed);
    const seedY = terrain.yOf(seed);
    let count = terrain.isWalkable(seed) && !blocked.has(seed) ? 0 : 1;
    const rows = fx.toInt(fx.div(cost, ROW_EDGE));
    for (let dy = -rows; dy <= rows; dy++) {
      const y = seedY + dy;
      if (y < 0) continue;
      // Past this many half-columns even the sideways bound alone exceeds the cost.
      const sidewaysLeft = fx.sub(cost, fx.mulInt(ROW_EDGE_OVER_QUARTER, Math.abs(dy)));
      const width = fx.toInt(fx.div(sidewaysLeft, HALF_COLUMN)) + 1;
      for (let x = seedX - width; x <= seedX + width; x++) {
        if (!terrain.inBounds(x, y) || walkLowerBound(seedX, seedY, x, y) > cost) continue;
        const node = terrain.nodeAt(x, y);
        const reachable = component === NO_COMPONENT || terrain.componentOf(node) === component;
        if (reachable && terrain.isWalkable(node) && !blocked.has(node)) count++;
      }
      if (count > budget) return count;
    }
    return count;
  }
}

/** The most {@link walkLowerBound} spans between `toward` and any node within `reach` Manhattan nodes of
 *  it, the bound being a metric, largest at a corner of that diamond. A walk to any of those nodes costs
 *  at least the bound to `toward` less this. */
function reachSlack(reach: number): Fixed {
  const across = doubledColumnDistance(2 * reach, 0);
  const along = doubledColumnDistance(reach & 1, reach);
  return across > along ? across : along;
}

/** A {@link SeedWalks} seed's walks toward nodes whose every cost lies past what its budget proves:
 *  the flood answers each, and a node off the seed's static component is never reached. */
class FloodAnswers implements WalkDistances {
  constructor(private readonly walks: SeedWalks) {}

  costFloor(node: NodeId): Fixed | undefined {
    return this.walks.floodCostFloor(node);
  }

  costTo(node: NodeId): Fixed | undefined {
    const { walks } = this;
    if (walks.component !== NO_COMPONENT && walks.terrain.componentOf(node) !== walks.component)
      return undefined;
    return walks.floodCostTo(node);
  }
}

/**
 * A walk out of a {@link SeedWalks} seed searched toward the nodes within `reach` Manhattan nodes of
 * `toward` (A* over {@link walkLowerBound}), so a target across open ground costs a corridor instead of
 * the whole disc out to it. A* settles every node at its true cost, which the seed's walks answer as
 * {@link SeedWalks.settledAnswer}; a node off the seed's static component is never reached; a search grown
 * to the budget answers {@link SeedWalks.cappedAnswer}.
 */
class DirectedWalk implements WalkDistances {
  private readonly costs = new WalkCosts();
  private readonly frontier = new WalkFrontier();
  private readonly steps = new StepBuffer();
  /** The bound from `toward` to the farthest node within `reach`, taken off every node's aim so it stays
   *  a lower bound on the walk to any of them. */
  private readonly slack: Fixed;
  /** The frontier ran dry: every node not settled is unreachable. */
  private exhausted = false;

  constructor(
    private readonly walks: SeedWalks,
    private readonly toward: HalfCellNode,
    reach: number,
  ) {
    this.slack = reachSlack(reach);
    const { seed } = walks;
    this.costs.page(seed)[seed & COST_PAGE_MASK] = ZERO;
    this.frontier.push(this.aim(seed), seed);
  }

  costFloor(node: NodeId): Fixed | undefined {
    const known = this.costs.settledCost(node);
    if (known !== undefined) return known;
    const least = this.frontier.peekCost();
    if (this.exhausted || least === undefined) return undefined;
    // Consistency: a walk to `node` leaves through a frontier node, so it costs at least the least aim
    // less what the bound still owes from `node`.
    const floor = fx.sub(least, this.aim(node));
    return floor > ZERO ? floor : ZERO;
  }

  costTo(node: NodeId): Fixed | undefined {
    const { walks } = this;
    const known = this.costs.settledCost(node);
    if (known !== undefined) return walks.settledAnswer(node, known);
    if (this.exhausted) return undefined;
    if (walks.component !== NO_COMPONENT && walks.terrain.componentOf(node) !== walks.component)
      return undefined;
    const cost = this.settleTo(node);
    if (cost === null) return walks.cappedAnswer(node);
    if (cost === undefined) return undefined;
    return walks.settledAnswer(node, cost);
  }

  /** Search on until `node` settles: its cost, undefined once nothing more can settle, or null once the
   *  search has settled the flood's budget. */
  private settleTo(node: NodeId): Fixed | undefined | null {
    const { costs, frontier, steps } = this;
    const { terrain, budget } = this.walks;
    const blocked = passOverlay(this.walks.blocked);
    while (frontier.size > 0) {
      if (costs.settledCount >= budget) return null;
      const next = frontier.pop();
      const page = costs.page(next);
      const at = next & COST_PAGE_MASK;
      const slot = page[at] ?? UNREACHED_COST;
      if (slot < 0 || slot === UNREACHED_COST) continue;
      const cost = slot as Fixed;
      page[at] = settledSlot(cost);
      costs.settledCount++;
      terrain.stepsInto(next, blocked, steps);
      for (let i = 0; i < steps.length; i++) {
        const stepNode = steps.nodeAt(i);
        const candidate = costs.page(stepNode);
        const offset = stepNode & COST_PAGE_MASK;
        const held = candidate[offset] ?? UNREACHED_COST;
        if (held < 0) continue;
        const stepCost = fx.add(cost, steps.costAt(i));
        if (held <= stepCost) continue;
        candidate[offset] = stepCost;
        frontier.push(fx.add(stepCost, this.aim(stepNode)), stepNode);
      }
      if (next === node) return cost;
    }
    this.exhausted = true;
    return undefined;
  }

  /** The heuristic: a lower bound on the walk from `node` to any node within reach of `toward`. */
  private aim(node: NodeId): Fixed {
    const { toward } = this;
    const { terrain } = this.walks;
    const bound = fx.sub(
      walkLowerBound(toward.hx, toward.hy, terrain.xOf(node), terrain.yOf(node)),
      this.slack,
    );
    return bound > ZERO ? bound : ZERO;
  }
}

/** The walkable unblocked node nearest `node` within `radius` Manhattan nodes, or null: the flood seed
 *  for an origin that sits inside a building's blocked body, such as a store's anchor. */
export function walkSeedNear(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  node: HalfCellNode,
  radius: number,
): NodeId | null {
  const seed = firstRingNode(node.hx, node.hy, radius, (x, y) => {
    if (!terrain.inBounds(x, y)) return false;
    const id = terrain.nodeAt(x, y);
    return terrain.isWalkable(id) && !blocked.has(id);
  });
  return seed === null ? null : terrain.nodeAt(seed.hx, seed.hy);
}
