import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Position,
  Stockpile,
  Vehicle,
} from '../../../components/index.js';
import { insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { isYardHeap, lowestStockedGood } from '../../stores/index.js';

/** A yard heap's load: the good it holds and how many units. */
export interface YardHeapFill {
  readonly good: number;
  readonly fill: number;
}

interface HeapCapture {
  readonly node: NodeId;
  readonly fill: YardHeapFill;
}

const byId = (e: Entity): number => e;

/**
 * Per node, the load of the yard heap lying there, the highest-id heap where several share a node.
 * Kept across ticks per world and caught up only by {@link yardOccupancy}, which the planner calls at
 * the start of its pass, so the whole pass reads the tick-start occupancy while its own drops land.
 */
class YardOccupancy {
  readonly byNode = new Map<NodeId, YardHeapFill>();
  readonly captures: JournaledCaptures<HeapCapture>;
  private readonly heapsByNode = new Map<NodeId, Entity[]>();
  private readonly fills = new Map<Entity, YardHeapFill>();

  constructor(
    readonly world: World,
    readonly terrain: TerrainGraph,
  ) {
    this.captures = new JournaledCaptures(
      world,
      {
        // A heap never moves: every Position write outside a re-add walks a settler or a delivery flag.
        membership: [Stockpile, Position, Building, Vehicle, GroundDrop, DeliveryFlag],
        values: [Stockpile],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e) => heapCapture(world, terrain, e),
        apply: (e, c) => {
          let heaps = this.heapsByNode.get(c.node);
          if (heaps === undefined) {
            heaps = [];
            this.heapsByNode.set(c.node, heaps);
          }
          insertSortedById(heaps, e, byId);
          this.fills.set(e, c.fill);
          this.settle(c.node);
        },
        withdraw: (e, c) => {
          const heaps = this.heapsByNode.get(c.node);
          if (heaps !== undefined) removeSortedById(heaps, e, byId);
          this.fills.delete(e);
          this.settle(c.node);
        },
        clear: () => {
          this.byNode.clear();
          this.heapsByNode.clear();
          this.fills.clear();
        },
      },
    );
  }

  private settle(node: NodeId): void {
    const heaps = this.heapsByNode.get(node);
    const top = heaps?.[heaps.length - 1];
    const fill = top === undefined ? undefined : this.fills.get(top);
    if (fill === undefined) {
      this.heapsByNode.delete(node);
      this.byNode.delete(node);
    } else {
      this.byNode.set(node, fill);
    }
  }

  verify(): string[] {
    this.captures.catchUp();
    const fresh = new Map<NodeId, YardHeapFill>();
    for (const e of this.world.canonicalQuery(Stockpile, Position)) {
      const c = heapCapture(this.world, this.terrain, e);
      if (c !== null) fresh.set(c.node, c.fill);
    }
    const problems: string[] = [];
    if (fresh.size !== this.byNode.size) {
      problems.push(`yardOccupancy holds ${this.byNode.size} nodes, a fresh scan finds ${fresh.size}`);
    }
    for (const [node, fill] of fresh) {
      const held = this.byNode.get(node);
      if (held?.good !== fill.good || held.fill !== fill.fill)
        problems.push(`yardOccupancy node ${node} is stale`);
    }
    return problems;
  }
}

const occupancies = new WeakMap<World, YardOccupancy>();

/** Every yard heap's load by node, caught up to the live world. The map is live: it holds still only
 *  until the next call. */
export function yardOccupancy(world: World, terrain: TerrainGraph): ReadonlyMap<NodeId, YardHeapFill> {
  let held = occupancies.get(world);
  if (held === undefined || held.terrain !== terrain) {
    if (held === undefined) {
      world.registerCacheVerifier('yardOccupancy', () => occupancies.get(world)?.verify() ?? []);
    }
    held = new YardOccupancy(world, terrain);
    occupancies.set(world, held);
  } else {
    held.captures.catchUp();
  }
  return held.byNode;
}

function heapCapture(world: World, terrain: TerrainGraph, e: Entity): HeapCapture | null {
  if (!isYardHeap(world, e)) return null;
  const stock = world.get(e, Stockpile);
  const good = lowestStockedGood(stock);
  if (good === null) return null;
  const p = world.get(e, Position);
  return {
    node: terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y)),
    fill: { good, fill: stock.amounts.get(good) ?? 0 },
  };
}
