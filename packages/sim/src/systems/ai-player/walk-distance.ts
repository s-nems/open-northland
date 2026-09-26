import { type Fixed, fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import { firstRingNode } from './node-geometry.js';

/** Walking costs from a seed set over the pathfinder's own edges, in the tile units its step costs
 *  carry (a half column is half a tile, a diagonal edge three quarters, roughness on top): a spot search
 *  ranks candidates by the trip a man walks round what blocks him, not as the crow flies. */
export interface WalkDistances {
  /** The cheapest walk from a seed to `node`, or undefined off the seeds' ground or past the flood budget. */
  costTo(node: NodeId): Fixed | undefined;
}

/** A binary min-heap of (cost, node), ties by node id, so the settle order is byte-identical. */
class WalkFrontier {
  private readonly costs: Fixed[] = [];
  private readonly nodes: NodeId[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(cost: Fixed, node: NodeId): void {
    this.costs.push(cost);
    this.nodes.push(node);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { cost: Fixed; node: NodeId } {
    const cost = this.costs[0];
    const node = this.nodes[0];
    if (cost === undefined || node === undefined) throw new Error('pop on an empty frontier');
    const lastCost = this.costs.pop();
    const lastNode = this.nodes.pop();
    if (this.nodes.length > 0 && lastCost !== undefined && lastNode !== undefined) {
      this.costs[0] = lastCost;
      this.nodes[0] = lastNode;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let least = i;
        if (left < this.nodes.length && this.before(left, least)) least = left;
        if (right < this.nodes.length && this.before(right, least)) least = right;
        if (least === i) break;
        this.swap(i, least);
        i = least;
      }
    }
    return { cost, node };
  }

  private before(a: number, b: number): boolean {
    const ca = this.costs[a] ?? 0;
    const cb = this.costs[b] ?? 0;
    if (ca !== cb) return ca < cb;
    return (this.nodes[a] ?? 0) < (this.nodes[b] ?? 0);
  }

  private swap(a: number, b: number): void {
    const cost = this.costs[a];
    const node = this.nodes[a];
    const otherCost = this.costs[b];
    const otherNode = this.nodes[b];
    if (cost === undefined || node === undefined || otherCost === undefined || otherNode === undefined)
      return;
    this.costs[a] = otherCost;
    this.nodes[a] = otherNode;
    this.costs[b] = cost;
    this.nodes[b] = node;
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
  private readonly settled = new Map<NodeId, Fixed>();
  private readonly frontier = new WalkFrontier();
  private readonly steps = new StepBuffer();

  constructor(
    private readonly terrain: TerrainGraph,
    private readonly blocked: BlockOverlay,
    seeds: readonly NodeId[],
    private readonly budget: number,
  ) {
    for (const seed of seeds) this.frontier.push(fx.fromInt(0), seed);
  }

  costTo(node: NodeId): Fixed | undefined {
    const known = this.settled.get(node);
    if (known !== undefined) return known;
    const { settled, frontier, steps } = this;
    while (frontier.size > 0 && settled.size < this.budget) {
      const { cost, node: next } = frontier.pop();
      if (settled.has(next)) continue;
      settled.set(next, cost);
      this.terrain.stepsInto(next, this.blocked, steps);
      for (let i = 0; i < steps.length; i++) {
        const step = steps.at(i);
        if (settled.has(step.node)) continue;
        frontier.push(fx.add(cost, step.cost), step.node);
      }
      if (next === node) return cost;
    }
    return undefined;
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
