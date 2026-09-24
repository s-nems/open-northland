import type { ContentSet } from '@open-northland/data';
import { Building, Position, Stockpile, UnderConstruction, Upgrading } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { edibleGoodFormOf, isFoodIn } from '../readviews/index.js';
import { NodeBuckets } from '../spatial/nodes.js';
import { accessibleStockAmounts } from '../stores/index.js';

/** A food source's anchor node, captured so a withdrawal finds its bucket after the store is gone. */
interface SourceNode {
  readonly hx: number;
  readonly hy: number;
}

const byId = (e: Entity): number => e;

/**
 * Every stockpile holding a unit that reaches a family as an edible, except a home, whose larder feeds
 * only its own residents: ascending ids and node buckets, kept across ticks. Caught up only where a pass
 * begins, so it holds still while that pass plans, and a store never moves while it holds stock.
 */
export class FoodSources {
  private readonly ids: Entity[] = [];
  private nodeBuckets: NodeBuckets;
  readonly captures: JournaledCaptures<SourceNode>;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
  ) {
    this.nodeBuckets = new NodeBuckets(world, []);
    this.captures = new JournaledCaptures<SourceNode>(
      world,
      {
        membership: [Stockpile, Position, Building, Upgrading, UnderConstruction],
        values: [Stockpile, Building, Upgrading],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e) => (isFoodSource(world, content, e) ? anchorNode(world, e) : null),
        apply: (e, node) => {
          insertSortedById(this.ids, e, byId);
          this.nodeBuckets.insert(e, node.hx, node.hy);
        },
        withdraw: (e, node) => {
          removeSortedById(this.ids, e, byId);
          this.nodeBuckets.remove(e, node.hx, node.hy);
        },
        clear: () => {
          this.ids.length = 0;
          this.nodeBuckets = new NodeBuckets(world, []);
        },
      },
    );
  }

  /** Ascending id, the linear scan's tie-break order. Shared: never mutate it. */
  get candidates(): readonly Entity[] {
    return this.ids;
  }

  get buckets(): NodeBuckets {
    return this.nodeBuckets;
  }

  verify(): string[] {
    this.captures.catchUp();
    const fresh = this.world
      .canonicalQuery(Stockpile, Position)
      .filter((e) => isFoodSource(this.world, this.content, e));
    const same = fresh.length === this.ids.length && fresh.every((e, i) => e === this.ids[i]);
    if (!same) return ['familyFoodSources disagree with a fresh store scan'];
    for (const e of fresh) {
      const node = anchorNode(this.world, e);
      if (!this.nodeBuckets.at(node.hx, node.hy).includes(e)) {
        return [`familyFoodSources holds store ${e} off its live node - a positioned stockpile moved`];
      }
    }
    return [];
  }
}

const sourcesByWorld = new WeakMap<World, FoodSources>();

/** The world's food sources caught up to the live world: call where a pass begins. */
export function foodSourcesOf(world: World, content: ContentSet): FoodSources {
  let held = sourcesByWorld.get(world);
  if (held === undefined || held.content !== content) {
    if (held === undefined) {
      world.registerCacheVerifier('familyFoodSources', () => sourcesByWorld.get(world)?.verify() ?? []);
    }
    held = new FoodSources(world, content);
    sourcesByWorld.set(world, held);
  } else {
    held.captures.catchUp();
  }
  return held;
}

function anchorNode(world: World, e: Entity): SourceNode {
  const p = world.get(e, Position);
  return { hx: nodeHxOfPosition(p.x, p.y), hy: nodeHyOfPosition(p.y) };
}

function isFoodSource(world: World, content: ContentSet, e: Entity): boolean {
  if (!world.has(e, Stockpile) || !world.has(e, Position)) return false;
  const building = world.tryGet(e, Building);
  if (building !== undefined && contentIndex(content).buildings.get(building.buildingType)?.kind === 'home') {
    return false;
  }
  return lowestStockedFood(world, content, e) !== null;
}

/**
 * The lowest stocked good (ascending good type) a family may take away from `store` as food, or null when
 * it holds none. Tested on the good's edible form, since the family's lift performs that conversion; the
 * returned type is the raw one to lift. A raw min-scan: the pick is order-free, and the canonical sorted
 * view would allocate and sort per store on the capture path.
 */
export function lowestStockedFood(world: World, content: ContentSet, store: Entity): number | null {
  let lowest: number | null = null;
  for (const [goodType, amount] of accessibleStockAmounts(world, store) ?? []) {
    if (amount <= 0 || (lowest !== null && goodType >= lowest)) continue;
    if (isFoodIn(content, edibleGoodFormOf(content, goodType))) lowest = goodType;
  }
  return lowest;
}
