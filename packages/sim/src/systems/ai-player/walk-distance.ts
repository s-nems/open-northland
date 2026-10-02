import { type Fixed, fx, ULP, ZERO } from '../../core/fixed.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../../nav/world-metric.js';
import { firstRingNode } from './node-geometry.js';

/** Walking costs from a seed set over the pathfinder's own edges, in the tile units their lengths carry
 *  (a half column is half a tile, a diagonal edge three quarters; ground is not weighed): a spot search
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
export const COST_PAGE_SIZE = 1 << COST_PAGE_SHIFT;
const COST_PAGE_MASK = COST_PAGE_SIZE - 1;
/** A page slot no walk has reached yet: past every cost, so no relaxation ever keeps it. */
const UNREACHED_COST = Number.POSITIVE_INFINITY;
interface CostPage {
  readonly costs: Float64Array;
  readonly settled: Uint8Array;
}

/** Pages are allocated only where this bounded flood visits. Indexed costs avoid a pair of per-node
 * Maps without allocating full-map buffers for each resource's small flood. */
class WalkCosts {
  private readonly pages: Array<CostPage | undefined> = [];
  settledCount = 0;

  page(node: NodeId): CostPage {
    const index = node >> COST_PAGE_SHIFT;
    let page = this.pages[index];
    if (page === undefined) {
      page = {
        costs: new Float64Array(COST_PAGE_SIZE).fill(UNREACHED_COST),
        settled: new Uint8Array(COST_PAGE_SIZE),
      };
      this.pages[index] = page;
    }
    return page;
  }

  settledCost(node: NodeId): Fixed | undefined {
    const page = this.pages[node >> COST_PAGE_SHIFT];
    const at = node & COST_PAGE_MASK;
    return page?.settled[at] === 1 ? (page.costs[at] as Fixed | undefined) : undefined;
  }
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

  constructor(
    private readonly terrain: TerrainGraph,
    private readonly blocked: BlockOverlay,
    seeds: readonly NodeId[],
    private readonly budget: number,
  ) {
    for (const seed of seeds) this.frontier.push(ZERO, seed);
  }

  costFloor(node: NodeId): Fixed | undefined {
    const known = this.costs.settledCost(node);
    if (known !== undefined) return known;
    // Every walk to an unsettled node leaves through the frontier, so it costs at least the frontier's least.
    return this.costs.settledCount < this.budget ? this.frontier.peekCost() : undefined;
  }

  costTo(node: NodeId): Fixed | undefined {
    const known = this.costs.settledCost(node);
    if (known !== undefined) return known;
    const { costs, frontier, steps } = this;
    while (frontier.size > 0 && costs.settledCount < this.budget) {
      const next = frontier.pop();
      const cost = frontier.poppedCost;
      const page = costs.page(next);
      const at = next & COST_PAGE_MASK;
      if (page.settled[at] === 1) continue;
      page.settled[at] = 1;
      page.costs[at] = cost;
      costs.settledCount++;
      this.terrain.stepsInto(next, this.blocked, steps);
      for (let i = 0; i < steps.length; i++) {
        const stepNode = steps.nodeAt(i);
        const candidate = costs.page(stepNode);
        const offset = stepNode & COST_PAGE_MASK;
        if (candidate.settled[offset] === 1) continue;
        const stepCost = fx.add(cost, steps.costAt(i));
        if ((candidate.costs[offset] ?? UNREACHED_COST) <= stepCost) continue;
        candidate.costs[offset] = stepCost;
        frontier.push(stepCost, stepNode);
      }
      if (next === node) return cost;
    }
    return undefined;
  }
}

/** Per node of E/W offset and of N/S offset, a lower bound on the walk across mostly E/W ground: half
 *  columns, each pair of rows climbed by a diagonal at its cost over a half column. */
const SHALLOW_PER_COLUMN = HALF_COLUMN;
const SHALLOW_PER_ROW = fx.div(fx.sub(DIAGONAL_STEP, HALF_COLUMN), fx.fromInt(2));
/** The same up mostly N/S ground: half rows, each column crossed by a diagonal at its cost over two. */
const STEEP_PER_COLUMN = fx.sub(DIAGONAL_STEP, fx.mulInt(HALF_ROW, 2));
const STEEP_PER_ROW = HALF_ROW;

/** A lower bound on any walk `dx` E/W and `dy` N/S half-cell nodes long. Both estimates are seminorms no
 *  single step costs less than, so the bound never overestimates and falls by at most a step's cost per
 *  step: a consistent A* heuristic. */
export function walkLowerBound(dx: number, dy: number): Fixed {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  const shallow = fx.add(fx.mulInt(SHALLOW_PER_COLUMN, x), fx.mulInt(SHALLOW_PER_ROW, y));
  const steep = fx.add(fx.mulInt(STEEP_PER_COLUMN, x), fx.mulInt(STEEP_PER_ROW, y));
  return shallow > steep ? shallow : steep;
}

/** The unobstructed lattice's step offsets and costs: {@link TerrainGraph.stepsInto}'s edge set on open
 *  ground, where no diagonal lacks a passable flank. */
const OPEN_STEPS: ReadonlyArray<readonly [dx: number, dy: number, cost: Fixed]> = [
  [1, 0, HALF_COLUMN],
  [-1, 0, HALF_COLUMN],
  [1, -2, DIAGONAL_STEP],
  [1, 2, DIAGONAL_STEP],
  [-1, 2, DIAGONAL_STEP],
  [-1, -2, DIAGONAL_STEP],
  [0, -1, HALF_ROW],
  [0, 1, HALF_ROW],
];
/** Packs an unobstructed lattice offset into one key; offsets stay far inside the span for any budget a
 *  map flood uses. */
const OPEN_LATTICE_SPAN = 1 << 13;
const OPEN_LATTICE_CENTRE = OPEN_LATTICE_SPAN >> 1;

const certainBelowByBudget = new Map<number, Fixed>();

/**
 * The walk cost under which a node always ranks within the first `budget` a {@link WalkFlood} settles:
 * the cost of the `budget + 1`-th node an open, unbounded lattice settles. A walk never undercuts the
 * open lattice's, so every node settled before one cheaper than this is one of those `budget`.
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
    for (const [dx, dy, cost] of OPEN_STEPS) {
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
      walkLowerBound(toward.hx - terrain.xOf(seed), toward.hy - terrain.yOf(seed)),
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
    this.flood ??= new WalkFlood(this.terrain, this.blocked, [this.seed], this.budget);
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
    const rows = fx.toInt(fx.div(cost, STEEP_PER_ROW));
    for (let dy = -rows; dy <= rows; dy++) {
      const y = seedY + dy;
      const rise = Math.abs(dy);
      const shallowLeft = fx.sub(cost, fx.mulInt(SHALLOW_PER_ROW, rise));
      const steepLeft = fx.sub(cost, fx.mulInt(STEEP_PER_ROW, rise));
      if (y < 0 || shallowLeft < ZERO || steepLeft < ZERO) continue;
      const shallowWidth = fx.toInt(fx.div(shallowLeft, SHALLOW_PER_COLUMN));
      const steepWidth = fx.toInt(fx.div(steepLeft, STEEP_PER_COLUMN));
      const width = Math.min(shallowWidth, steepWidth);
      for (let x = seedX - width; x <= seedX + width; x++) {
        if (!terrain.inBounds(x, y)) continue;
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
 *  it, the bound being the larger of two seminorms, each largest at a corner of that diamond. A walk to
 *  any of those nodes costs at least the bound to `toward` less this. */
function reachSlack(reach: number): Fixed {
  const across = walkLowerBound(reach, 0);
  const along = walkLowerBound(0, reach);
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
    this.costs.page(seed).costs[seed & COST_PAGE_MASK] = ZERO;
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
    const { terrain, blocked, budget } = this.walks;
    while (frontier.size > 0) {
      if (costs.settledCount >= budget) return null;
      const next = frontier.pop();
      const page = costs.page(next);
      const at = next & COST_PAGE_MASK;
      const cost = (page.costs[at] ?? UNREACHED_COST) as Fixed;
      if (page.settled[at] === 1 || cost === UNREACHED_COST) continue;
      page.settled[at] = 1;
      costs.settledCount++;
      terrain.stepsInto(next, blocked, steps);
      for (let i = 0; i < steps.length; i++) {
        const stepNode = steps.nodeAt(i);
        const candidate = costs.page(stepNode);
        const offset = stepNode & COST_PAGE_MASK;
        if (candidate.settled[offset] === 1) continue;
        const stepCost = fx.add(cost, steps.costAt(i));
        if ((candidate.costs[offset] ?? UNREACHED_COST) <= stepCost) continue;
        candidate.costs[offset] = stepCost;
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
      walkLowerBound(terrain.xOf(node) - toward.hx, terrain.yOf(node) - toward.hy),
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
