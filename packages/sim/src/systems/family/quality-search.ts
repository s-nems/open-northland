import { Building, ownerOf, ownersCompatible, Position, Stockpile } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { interactionCell } from '../settlers/targets/index.js';
import { NodeBuckets } from '../spatial/nodes.js';
import { accessibleStockAmounts } from '../stores/index.js';

/** Per-tick searchable view of external stores carrying a configured household-quality good. */
export class ExternalQualityIndex {
  private readonly candidates: readonly Entity[];
  private readonly buckets: NodeBuckets;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph | undefined,
  ) {
    this.candidates = world
      .canonicalQuery(Stockpile, Position)
      .filter((e) => !this.isHome(e) && this.lowestDemanded(e) !== null);
    this.buckets = new NodeBuckets(world, this.candidates);
  }

  nearest(
    from: { hx: number; hy: number },
    owner: number | undefined,
    demanded: ReadonlySet<number>,
    gate: SpatialGate | null,
    avoid?: (cell: NodeId) => boolean,
  ): { store: Entity; goodType: number } | null {
    const here = this.terrain?.nodeAtClamped(from.hx, from.hy);
    const accept = (store: Entity): boolean => {
      if (!ownersCompatible(owner, ownerOf(this.world, store))) return false;
      const goodType = this.lowestDemanded(store, demanded);
      if (goodType === null) return false;
      const cell =
        this.terrain !== undefined && here !== undefined
          ? interactionCell(this.world, this.ctx, this.terrain, store, here)
          : null;
      if (cell !== null && gate !== null && !gate.allowsNode(cell)) return false;
      if (cell !== null && cell !== here && avoid?.(cell) === true) return false;
      return true;
    };
    const hit =
      this.candidates.length <= RING_MIN_CANDIDATES
        ? null
        : this.buckets.nearest(from.hx, from.hy, 0, RING_MAX_RADIUS, accept);
    const store = hit?.entity ?? this.linearNearest(from, accept);
    if (store === null) return null;
    const goodType = this.lowestDemanded(store, demanded);
    return goodType === null ? null : { store, goodType };
  }

  private linearNearest(from: { hx: number; hy: number }, accept: (e: Entity) => boolean): Entity | null {
    let best: { store: Entity; distance: number } | null = null;
    for (const store of this.candidates) {
      if (!accept(store)) continue;
      const p = this.world.get(store, Position);
      const node = nodeOfPosition(p.x, p.y);
      const distance = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
      if (best === null || distance < best.distance) best = { store, distance };
    }
    return best?.store ?? null;
  }

  private lowestDemanded(store: Entity, demanded?: ReadonlySet<number>): number | null {
    let lowest: number | null = null;
    for (const [goodType, amount] of accessibleStockAmounts(this.world, store) ?? []) {
      if (amount <= 0 || (demanded !== undefined && !demanded.has(goodType))) continue;
      if (contentIndex(this.ctx.content).goods.get(goodType)?.homeQuality === undefined) continue;
      if (lowest === null || goodType < lowest) lowest = goodType;
    }
    return lowest;
  }

  private isHome(e: Entity): boolean {
    const building = this.world.tryGet(e, Building);
    if (building === undefined) return false;
    return contentIndex(this.ctx.content).buildings.get(building.buildingType)?.kind === 'home';
  }
}

const RING_MAX_RADIUS = 48;
const RING_MIN_CANDIDATES = 64;
