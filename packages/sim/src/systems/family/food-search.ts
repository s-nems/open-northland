import type { ContentSet } from '@open-northland/data';
import { ownerOf, ownersCompatible, Position, Stockpile } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { edibleGoodFormOf, isFoodIn } from '../readviews/index.js';
import { hasRoom } from '../settlers/drives/economy/store-policy.js';
import { interactionCell, unclaimedGoodsAt } from '../settlers/targets/index.js';
import { accessibleStockAmounts, mayFetchGoodFrom, type SupplyTally } from '../stores/index.js';
import { type FoodSources, foodSourcesOf } from './food-sources.js';

/**
 * The greatest Manhattan ring radius (half-cell nodes) {@link ExternalFoodIndex.nearest} expands to before
 * falling back to the linear scan. Authored performance cap: the fallback reproduces the exact linear
 * winner.
 */
const RING_MAX_RADIUS = 48;

/**
 * Count of the seeker's own side's candidates at or below which {@link ExternalFoodIndex.nearest} goes
 * straight to the linear scan over that side. Performance knob with an identical winner: the ring and the
 * linear scan share the (distance, entity-id) order, and the ring rejects every other side's candidate. A
 * full sweep reads about 2 * {@link RING_MAX_RADIUS}^2 nodes, more than a few hundred candidates judged
 * nearest-first.
 */
const RING_MIN_CANDIDATES = 256;

/**
 * One pass's view of the shared {@link FoodSources}, caught up when the pass makes it: each seeker pays a
 * bounded ring search over it, with her own side, signpost gate and failed goals applied per query. A
 * placement mid-pass may destroy a listed pile; every read of a candidate tolerates that, and `accept`
 * rejects it through its missing Position or stock.
 */
export class ExternalFoodIndex {
  private readonly sources: FoodSources;
  private readonly roomy: number[] = [];

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph | undefined,
    private readonly supply: SupplyTally,
  ) {
    this.sources = foodSourcesOf(world, ctx.content);
  }

  /**
   * The nearest external food source to `from` holding an unclaimed unit of a food `home`'s larder has
   * room for, or null when none exists anywhere. A food whose slot is full is skipped, since the delivery
   * would be refused and the unit carried straight back. `gate` is the seeker's signpost confinement (null
   * when unlimited), `avoid` her failed-goal veto, probed at the source's interaction cell, the node
   * `fetchFrom` walks to. `owner` is her player: she hauls only out of her own side's stores. The shared
   * candidate list is owner-blind, so her side is checked per seeker.
   */
  nearest(
    from: { hx: number; hy: number },
    owner: number | undefined,
    home: Entity,
    gate: SpatialGate | null,
    avoid?: (cell: NodeId) => boolean,
  ): { store: Entity; goodType: number } | null {
    const { candidates, buckets } = this.sources;
    if (candidates.length === 0) return null;
    if (!this.world.has(home, Stockpile)) return null;
    const roomy = this.foodsWithRoomAt(home);
    // No store can then offer her a unit, so the scan over every candidate is skipped.
    if (roomy.length === 0) return null;
    // The area test goes before the stock read: on islands most of a side's stores stand on other land.
    const accept = (e: Entity): boolean =>
      ownersCompatible(owner, ownerOf(this.world, e)) &&
      this.inArea(e, gate) &&
      this.liftableFood(e, roomy) !== null &&
      !this.standRetired(e, from, avoid);
    const side = this.onSide(owner);
    const ringed = side.length > RING_MIN_CANDIDATES;
    const hit = ringed ? buckets.nearest(from.hx, from.hy, 0, RING_MAX_RADIUS, accept) : null;
    // A ring sweep that missed rejected every candidate inside its radius already.
    const store = hit?.entity ?? this.linearNearest(side, from, accept, ringed ? RING_MAX_RADIUS : -1);
    if (store === null) return null;
    const goodType = this.liftableFood(store, roomy);
    // A null here would mean a mid-pass mutation drained the winner: fail the query rather than guess.
    return goodType === null ? null : { store, goodType };
  }

  /** The candidates `owner` may haul from, ascending id; `accept` still checks the side. */
  private onSide(owner: number | undefined): readonly Entity[] {
    return this.sources.onSide(owner);
  }

  /** The family foods, ascending, that `home`'s larder has room for: one scratch list, valid until the
   *  next query. */
  private foodsWithRoomAt(home: Entity): readonly number[] {
    const roomy = this.roomy;
    roomy.length = 0;
    for (const goodType of familyFoods(this.ctx.content)) {
      if (hasRoom(this.world, this.ctx, home, goodType)) roomy.push(goodType);
    }
    return roomy;
  }

  /** The lowest of the ascending `roomy` foods `store` holds a unit of that no walker has claimed: the
   *  `lowestStockedFood` pick, probed per food rather than over the store's whole inventory. */
  private liftableFood(store: Entity, roomy: readonly number[]): number | null {
    const { world, supply } = this;
    const amounts = accessibleStockAmounts(world, store);
    if (amounts === undefined) return null;
    let unclaimed: ((goodType: number) => boolean) | undefined | null = null;
    for (let i = 0; i < roomy.length; i++) {
      const goodType = roomy[i];
      if (goodType === undefined || (amounts.get(goodType) ?? 0) <= 0) continue;
      if (!mayFetchGoodFrom(world, this.ctx, store, goodType)) continue;
      if (unclaimed === null) unclaimed = unclaimedGoodsAt(world, this.ctx, supply, store);
      if (unclaimed === undefined || unclaimed(goodType)) return goodType;
    }
    return null;
  }

  /** Whether the seeker's `avoid` veto retires this source's interaction cell, her own stand exempt. */
  private standRetired(
    e: Entity,
    from: { hx: number; hy: number },
    avoid: ((cell: NodeId) => boolean) | undefined,
  ): boolean {
    if (avoid === undefined || this.terrain === undefined) return false;
    const here = this.terrain.nodeAtClamped(from.hx, from.hy);
    const cell = interactionCell(this.world, this.ctx, this.terrain, e, here);
    return cell !== here && avoid(cell);
  }

  /** Whether the store's own node lies inside the seeker's allowed area (no gate/terrain = everywhere).
   *  A pile displaced mid-pass has no Position and reads as outside, as its missing stock would reject it. */
  private inArea(e: Entity, gate: SpatialGate | null): boolean {
    if (gate === null || this.terrain === undefined) return true;
    const p = this.world.tryGet(e, Position);
    if (p === undefined) return false;
    return gate.allowsNode(
      this.terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y)),
    );
  }

  /** The strictly-nearer pick over the ascending-id candidates beyond Manhattan distance `swept`. The
   *  distance is read first, so a candidate that could not win is never judged. */
  private linearNearest(
    candidates: readonly Entity[],
    from: { hx: number; hy: number },
    accept: (e: Entity) => boolean,
    swept: number,
  ): Entity | null {
    let best: Entity | null = null;
    let bestDist = 0;
    for (const e of candidates) {
      // A pile a placement earlier in this pass displaced is gone from the world but not from the list.
      const p = this.world.tryGet(e, Position);
      if (p === undefined) continue;
      const dist =
        Math.abs(nodeHxOfPosition(p.x, p.y) - from.hx) + Math.abs(nodeHyOfPosition(p.x, p.y) - from.hy);
      if (dist <= swept || (best !== null && dist >= bestDist)) continue;
      if (accept(e)) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }
}

/** Every good a family takes away as food (see `lowestStockedFood`), ascending, per content set. */
const familyFoodsByContent = new WeakMap<ContentSet, readonly number[]>();

function familyFoods(content: ContentSet): readonly number[] {
  let foods = familyFoodsByContent.get(content);
  if (foods === undefined) {
    foods = [...contentIndex(content).goods.keys()]
      .filter((goodType) => isFoodIn(content, edibleGoodFormOf(content, goodType)))
      .sort((a, b) => a - b);
    familyFoodsByContent.set(content, foods);
  }
  return foods;
}
