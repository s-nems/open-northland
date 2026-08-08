import { Building, ownerOf, ownersCompatible, Position, Stockpile } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { exportedGoodForm, isFood } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
import { canonicalById, NodeBuckets } from '../spatial/nodes.js';

/**
 * The greatest Manhattan ring radius (half-cell nodes) {@link ExternalFoodIndex.nearest} expands to before
 * falling back to the linear scan. Authored performance cap: the fallback reproduces the exact linear
 * winner.
 */
const RING_MAX_RADIUS = 48;

/**
 * Candidate count at or below which {@link ExternalFoodIndex.nearest} goes straight to the linear scan.
 * Performance knob with an identical winner: the ring and the linear scan share the
 * (distance, entity-id) order. Approximation.
 */
const RING_MIN_CANDIDATES = 64;

/**
 * A per-tick index over the stockpiles a family may draw food from: any store or ground pile holding a
 * unit that reaches her back as an edible, except a home, whose larder feeds only its own residents. The
 * whole-world `Stockpile+Position` scan happens once per tick here, and each seeker pays a bounded ring
 * search over it.
 *
 * Candidacy is snapshotted lazily on first query, which is exact within a pass because stock mutates only
 * on atomic completion, never while a planner or family pass issues actions.
 */
export class ExternalFoodIndex {
  private candidates: readonly Entity[] | undefined;
  private buckets: NodeBuckets | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph | undefined,
  ) {}

  /**
   * The nearest external food source to `from`, or null when none exists anywhere. `gate` is the seeker's
   * signpost confinement (null when unlimited), `avoid` her failed-goal veto, probed at the source's
   * interaction cell, the node `fetchFrom` walks to. `owner` is her player: she hauls only out of her own
   * side's stores. The shared candidate list is owner-blind, so her side is checked per seeker.
   */
  nearest(
    from: { hx: number; hy: number },
    owner: number | undefined,
    gate: SpatialGate | null,
    avoid?: (cell: NodeId) => boolean,
  ): { store: Entity; goodType: number } | null {
    if (this.candidates === undefined || this.buckets === undefined) {
      this.candidates = canonicalById(this.world.query(Stockpile, Position)).filter(
        (e) => !this.isHome(e) && lowestStockedFood(this.world, this.ctx, e) !== null,
      );
      this.buckets = new NodeBuckets(this.world, this.candidates);
    }
    if (this.candidates.length === 0) return null;
    const accept = (e: Entity): boolean =>
      ownersCompatible(owner, ownerOf(this.world, e)) &&
      this.inArea(e, gate) &&
      !this.standRetired(e, from, avoid);
    const hit =
      this.candidates.length <= RING_MIN_CANDIDATES
        ? null
        : this.buckets.nearest(from.hx, from.hy, 0, RING_MAX_RADIUS, accept);
    const store = hit?.entity ?? this.linearNearest(from, accept);
    if (store === null) return null;
    const goodType = lowestStockedFood(this.world, this.ctx, store);
    // A null here would mean a mid-pass mutation drained the winner: fail the query rather than guess.
    return goodType === null ? null : { store, goodType };
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

  /** Whether the stockpile is a home-kind building (its larder is its residents' alone). */
  private isHome(e: Entity): boolean {
    const building = this.world.tryGet(e, Building);
    if (building === undefined) return false;
    return contentIndex(this.ctx.content).buildings.get(building.buildingType)?.kind === 'home';
  }

  /** The strictly-nearer pick over the ascending-id candidates, covering sources beyond
   *  {@link RING_MAX_RADIUS}. */
  private linearNearest(from: { hx: number; hy: number }, accept: (e: Entity) => boolean): Entity | null {
    let best: { store: Entity; dist: number } | null = null;
    for (const e of this.candidates ?? []) {
      if (!accept(e)) continue;
      const p = this.world.get(e, Position);
      const node = nodeOfPosition(p.x, p.y);
      const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
      if (best === null || dist < best.dist) best = { store: e, dist };
    }
    return best?.store ?? null;
  }
}

/**
 * The lowest stocked good (ascending good type) a family may take away from `store` as food, or null when
 * it holds none. Tested on the good's edible form, since the family's lift performs that conversion; the
 * returned type is the raw one to lift. A raw min-scan: the pick is order-free, and the canonical sorted
 * view would allocate and sort per store per query on the candidate-filter hot path.
 */
function lowestStockedFood(world: World, ctx: SystemContext, store: Entity): number | null {
  let lowest: number | null = null;
  for (const [goodType, amount] of world.get(store, Stockpile).amounts) {
    if (amount <= 0 || (lowest !== null && goodType >= lowest)) continue;
    if (isFood(ctx, exportedGoodForm(ctx, goodType))) lowest = goodType;
  }
  return lowest;
}
