import { Building, Position, Stockpile, stockpileEntries } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { canonicalById, NodeBuckets } from '../spatial.js';
import { isFood } from '../stores/index.js';

/**
 * The greatest Manhattan ring radius (half-cell nodes) {@link ExternalFoodIndex.nearest} expands to
 * before falling back to the linear scan. A pure performance knob (the fallback reproduces the exact
 * linear winner), mirroring the interaction-cell index's bound — not a decoded distance (named
 * approximation).
 */
const RING_MAX_RADIUS = 48;

/**
 * A per-tick index over the stockpiles a family may draw food from: any store or ground pile holding
 * an edible unit EXCEPT a home (a larder feeds only its own residents). Both family food-seekers — the
 * child-order haul stage and the housewife hoard rung — run per woman per tick, so the whole-world
 * `Stockpile+Position` scan lives HERE, once per tick, and each seeker pays a bounded ring search
 * (`NodeBuckets.nearest`); a world with no external food at all answers every seeker in O(1).
 *
 * The winner is byte-identical to the linear scan this replaces: distance is half-cell Manhattan from
 * the store's own position node, tie-broken by ascending entity id — exactly `NodeBuckets.nearest`'s
 * documented order — and the out-of-ring fallback reruns the original loop over the (pre-filtered)
 * candidates. Candidacy is snapshotted lazily on first query; that is exact within a pass, because
 * stock only mutates on atomic COMPLETION (a later system phase), never while a planner/family pass
 * issues actions.
 */
export class ExternalFoodIndex {
  private candidates: readonly Entity[] | undefined;
  private buckets: NodeBuckets | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
  ) {}

  /** The nearest external food source to `from`, or null when none exists anywhere. */
  nearest(from: { hx: number; hy: number }): { store: Entity; goodType: number } | null {
    if (this.candidates === undefined || this.buckets === undefined) {
      this.candidates = canonicalById(this.world.query(Stockpile, Position)).filter(
        (e) => !this.isHome(e) && lowestStockedFood(this.world, this.ctx, e) !== null,
      );
      this.buckets = new NodeBuckets(this.world, this.candidates);
    }
    if (this.candidates.length === 0) return null;
    const hit = this.buckets.nearest(from.hx, from.hy, 0, RING_MAX_RADIUS, () => true);
    const store = hit?.entity ?? this.linearNearest(from);
    if (store === null) return null;
    const goodType = lowestStockedFood(this.world, this.ctx, store);
    return goodType === null ? null : { store, goodType };
  }

  /** Whether the stockpile is a home-kind building (its larder is its residents' alone). */
  private isHome(e: Entity): boolean {
    const building = this.world.tryGet(e, Building);
    if (building === undefined) return false;
    return contentIndex(this.ctx.content).buildings.get(building.buildingType)?.kind === 'home';
  }

  /** The exact pre-index linear pick — strictly-nearer over the ascending-id candidates — covering
   *  sources beyond {@link RING_MAX_RADIUS} (anything within it would have won the ring). */
  private linearNearest(from: { hx: number; hy: number }): Entity | null {
    let best: { store: Entity; dist: number } | null = null;
    for (const e of this.candidates ?? []) {
      const p = this.world.get(e, Position);
      const node = nodeOfPosition(p.x, p.y);
      const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
      if (best === null || dist < best.dist) best = { store: e, dist };
    }
    return best?.store ?? null;
  }
}

/** A store's lowest stocked edible goodType (canonical order), or null when it holds none. */
export function lowestStockedFood(world: World, ctx: SystemContext, store: Entity): number | null {
  for (const [goodType, amount] of stockpileEntries(world.get(store, Stockpile))) {
    if (amount > 0 && isFood(ctx, goodType)) return goodType;
  }
  return null;
}
