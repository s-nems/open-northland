import type { ContentSet } from '@open-northland/data';
import {
  Building,
  Owner,
  ownerOf,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { isEdibleFoodIn } from '../readviews/index.js';
import { NodeBuckets } from '../spatial/nodes.js';
import { accessibleStockAmounts, recipeConsumes } from '../stores/index.js';
import { SidedCandidates, sidesMatch } from './candidate-sides.js';

/**
 * Meat, the food women fetch for their larders before any other (owner ruling): the animal farm's
 * slaughter lands it, and a full shelf of it keeps the breeder carrying meat out instead of slaughtering.
 */
const MEAT_GOOD_ID = 'meat';

/** A food source's anchor node, owner and meat flag, captured so a withdrawal finds its bucket and sides
 *  after the store is gone. */
interface SourceNode {
  readonly hx: number;
  readonly hy: number;
  readonly owner: number | undefined;
  /** Whether the store holds a unit of {@link MEAT_GOOD_ID}. */
  readonly meat: boolean;
}

/**
 * Every stockpile holding a unit that reaches a family as an edible, except a home, whose larder feeds
 * only its own residents: ascending ids and node buckets, kept across ticks. Caught up only where a pass
 * begins, so it holds still while that pass plans, and a store never moves while it holds stock.
 */
export class FoodSources {
  private readonly sides = new SidedCandidates();
  private readonly meat = new SidedCandidates();
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
        membership: [Stockpile, Position, Building, Upgrading, UnderConstruction, Owner],
        values: [Stockpile, Building, Upgrading, Owner],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e) => (isFoodSource(world, content, e) ? sourceNode(world, content, e) : null),
        apply: (e, node) => {
          this.sides.insert(e, node.owner);
          if (node.meat) this.meat.insert(e, node.owner);
          this.nodeBuckets.insert(e, node.hx, node.hy);
        },
        withdraw: (e, node) => {
          this.sides.remove(e, node.owner);
          if (node.meat) this.meat.remove(e, node.owner);
          this.nodeBuckets.remove(e, node.hx, node.hy);
        },
        clear: () => {
          this.sides.clear();
          this.meat.clear();
          this.nodeBuckets = new NodeBuckets(world, []);
        },
      },
    );
  }

  /** Ascending id, the linear scan's tie-break order. Live: read it within one query, never write it. */
  get candidates(): readonly Entity[] {
    return this.sides.all;
  }

  /** The sources `owner` may haul from, ascending id; see {@link SidedCandidates.of}. */
  onSide(owner: number | undefined): readonly Entity[] {
    return this.sides.of(owner);
  }

  /** {@link onSide} narrowed to the sources holding meat, ascending id. */
  meatOn(owner: number | undefined): readonly Entity[] {
    return this.meat.of(owner);
  }

  get buckets(): NodeBuckets {
    return this.nodeBuckets;
  }

  verify(): string[] {
    this.captures.catchUp();
    const fresh = this.world
      .canonicalQuery(Stockpile, Position)
      .filter((e) => isFoodSource(this.world, this.content, e));
    const held = this.candidates;
    const same = fresh.length === held.length && fresh.every((e, i) => e === held[i]);
    if (!same) return ['familyFoodSources disagree with a fresh store scan'];
    if (!sidesMatch(this.world, fresh, this.sides)) return ['familyFoodSources hold a store on a stale side'];
    const meat = fresh.filter((e) => holdsMeat(this.world, this.content, e));
    if (!sidesMatch(this.world, meat, this.meat)) {
      return ['familyFoodSources disagree with a fresh scan on the stores holding meat'];
    }
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

function sourceNode(world: World, content: ContentSet, e: Entity): SourceNode {
  const { hx, hy } = anchorNode(world, e);
  return { hx, hy, owner: ownerOf(world, e), meat: holdsMeat(world, content, e) };
}

function anchorNode(world: World, e: Entity): { readonly hx: number; readonly hy: number } {
  const p = world.get(e, Position);
  return { hx: nodeHxOfPosition(p.x, p.y), hy: nodeHyOfPosition(p.x, p.y) };
}

const meatByContent = new WeakMap<ContentSet, number | null>();

/** The meat good's type, or null for a content set without one. */
export function meatGoodOf(content: ContentSet): number | null {
  let meat = meatByContent.get(content);
  if (meat === undefined) {
    meat = content.goods.find((g) => g.id === MEAT_GOOD_ID)?.typeId ?? null;
    meatByContent.set(content, meat);
  }
  return meat;
}

function holdsMeat(world: World, content: ContentSet, e: Entity): boolean {
  const meat = meatGoodOf(content);
  return meat !== null && (accessibleStockAmounts(world, e)?.get(meat) ?? 0) > 0;
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
 * returned type is the raw one to lift. Recipe inputs remain reserved for production, even when edible.
 * `accepts`, when given, further restricts the raw good. A raw
 * min-scan over `keys()` plus `get`: the pick is order-free, and both the canonical sorted view and
 * destructured entries would allocate per store on the capture path and in every settler's larder search.
 */
export function lowestStockedFood(
  world: World,
  content: ContentSet,
  store: Entity,
  accepts?: (goodType: number) => boolean,
): number | null {
  const amounts = accessibleStockAmounts(world, store);
  if (amounts === undefined) return null;
  const building = world.tryGet(store, Building);
  const inputs =
    building === undefined
      ? undefined
      : contentIndex(content).mergedRecipeByBuilding.get(building.buildingType)?.inputs;
  let lowest: number | null = null;
  for (const goodType of amounts.keys()) {
    if ((amounts.get(goodType) ?? 0) <= 0 || (lowest !== null && goodType >= lowest)) continue;
    if (!isEdibleFoodIn(content, goodType) || recipeConsumes(inputs, goodType)) continue;
    if (accepts === undefined || accepts(goodType)) lowest = goodType;
  }
  return lowest;
}
