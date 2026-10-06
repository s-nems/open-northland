import { ownerOf, ownersCompatible, Position, Stockpile } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { hasRoom } from '../settlers/drives/economy/store-policy.js';
import { interactionCell, unclaimedGoodsAt } from '../settlers/targets/index.js';
import type { SupplyTally } from '../stores/index.js';
import { type FoodSources, foodSourcesOf, lowestStockedFood } from './food-sources.js';

/**
 * The greatest Manhattan ring radius (half-cell nodes) {@link ExternalFoodIndex.nearest} expands to before
 * falling back to the linear scan. Authored performance cap: the fallback reproduces the exact linear
 * winner.
 */
const RING_MAX_RADIUS = 48;

/**
 * Candidate count at or below which {@link ExternalFoodIndex.nearest} goes straight to the linear scan.
 * Performance knob with an identical winner: the ring and the linear scan share the
 * (distance, entity-id) order. A full sweep reads about 2 * {@link RING_MAX_RADIUS}^2 nodes, more than
 * a few hundred candidates judged nearest-first.
 */
const RING_MIN_CANDIDATES = 256;

/**
 * One pass's view of the shared {@link FoodSources}, caught up when the pass makes it: each seeker pays a
 * bounded ring search over it, with her own side, signpost gate and failed goals applied per query.
 */
export class ExternalFoodIndex {
  private readonly sources: FoodSources;

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
    const fitsHome = (goodType: number): boolean => hasRoom(this.world, this.ctx, home, goodType);
    const accept = (e: Entity): boolean =>
      ownersCompatible(owner, ownerOf(this.world, e)) &&
      this.inArea(e, gate) &&
      this.liftableFood(e, fitsHome) !== null &&
      !this.standRetired(e, from, avoid);
    const hit =
      candidates.length <= RING_MIN_CANDIDATES
        ? null
        : buckets.nearest(from.hx, from.hy, 0, RING_MAX_RADIUS, accept);
    // A ring sweep that missed rejected every candidate inside its radius already.
    const swept = candidates.length <= RING_MIN_CANDIDATES ? -1 : RING_MAX_RADIUS;
    const store = hit?.entity ?? this.linearNearest(candidates, from, accept, swept);
    if (store === null) return null;
    const goodType = this.liftableFood(store, fitsHome);
    // A null here would mean a mid-pass mutation drained the winner: fail the query rather than guess.
    return goodType === null ? null : { store, goodType };
  }

  /** The lowest food `store` holds that `fitsHome` and that no walker has claimed every unit of. */
  private liftableFood(store: Entity, fitsHome: (goodType: number) => boolean): number | null {
    const { world, supply } = this;
    const unclaimed = unclaimedGoodsAt(world, supply, store);
    const accepts =
      unclaimed === undefined
        ? fitsHome
        : (goodType: number): boolean => fitsHome(goodType) && unclaimed(goodType);
    return lowestStockedFood(world, this.ctx.content, store, accepts);
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

  /** Whether the store's own node lies inside the seeker's allowed area (no gate/terrain = everywhere). */
  private inArea(e: Entity, gate: SpatialGate | null): boolean {
    if (gate === null || this.terrain === undefined) return true;
    const p = this.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    return gate.allowsNode(this.terrain.nodeAtClamped(node.hx, node.hy));
  }

  /** The strictly-nearer pick over the ascending-id candidates beyond Manhattan distance `swept`. The
   *  distance is read first, so a candidate that could not win is never judged. */
  private linearNearest(
    candidates: readonly Entity[],
    from: { hx: number; hy: number },
    accept: (e: Entity) => boolean,
    swept: number,
  ): Entity | null {
    let best: { store: Entity; dist: number } | null = null;
    for (const e of candidates) {
      const p = this.world.get(e, Position);
      const node = nodeOfPosition(p.x, p.y);
      const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
      if (dist <= swept || (best !== null && dist >= best.dist)) continue;
      if (accept(e)) best = { store: e, dist };
    }
    return best?.store ?? null;
  }
}
