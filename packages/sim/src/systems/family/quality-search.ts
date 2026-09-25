import type { ContentSet } from '@open-northland/data';
import {
  Building,
  ownerOf,
  ownersCompatible,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { interactionCell } from '../settlers/targets/index.js';
import { NodeBuckets } from '../spatial/nodes.js';
import { accessibleStockAmounts } from '../stores/index.js';

/**
 * Per-tick searchable view of external stores carrying a configured household-quality good. The
 * candidates are the ones stocked when the view is made. Their node buckets are kept while the list is
 * unchanged, which holds because a positioned stockpile never moves in place (`spatial/stockpiles.ts`).
 */
export class ExternalQualityIndex {
  private readonly sources: QualitySources;
  private readonly candidates: readonly Entity[];

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph | undefined,
  ) {
    this.sources = qualitySources(world, ctx.content);
    this.candidates = this.sources.list();
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
        : this.bucketed().nearest(from.hx, from.hy, 0, RING_MAX_RADIUS, accept);
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

  private bucketed(): NodeBuckets {
    return this.sources.bucketsOf(this.candidates);
  }

  private lowestDemanded(store: Entity, demanded: ReadonlySet<number>): number | null {
    return lowestQualityGood(this.world, this.ctx.content, store, demanded);
  }
}

/** The lowest household-quality good `store` holds a unit of, among `demanded` when given. A min over
 *  `keys()` plus `get`: destructured entries would allocate a pair per stock line of every candidate. */
function lowestQualityGood(
  world: World,
  content: ContentSet,
  store: Entity,
  demanded?: ReadonlySet<number>,
): number | null {
  const amounts = accessibleStockAmounts(world, store);
  if (amounts === undefined) return null;
  let lowest: number | null = null;
  for (const goodType of amounts.keys()) {
    if ((amounts.get(goodType) ?? 0) <= 0 || (demanded !== undefined && !demanded.has(goodType))) continue;
    if (contentIndex(content).goods.get(goodType)?.homeQuality === undefined) continue;
    if (lowest === null || goodType < lowest) lowest = goodType;
  }
  return lowest;
}

/** Whether a store may lend a household a quality good: any stocked store but a home, whose goods serve
 *  only its own residents. */
function isQualitySource(world: World, content: ContentSet, e: Entity): boolean {
  if (!world.has(e, Stockpile) || !world.has(e, Position)) return false;
  const building = world.tryGet(e, Building);
  if (building !== undefined && contentIndex(content).buildings.get(building.buildingType)?.kind === 'home') {
    return false;
  }
  return lowestQualityGood(world, content, e) !== null;
}

const byId = (e: Entity): number => e;

/** One world's quality sources in ascending id, kept across ticks and caught up by {@link qualitySources}. */
class QualitySources {
  private readonly ids: Entity[] = [];
  private frozen: readonly Entity[] | null = null;
  /** Buckets of the list they were last filled from, refilled only when a different list is searched. */
  private readonly buckets: NodeBuckets;
  private bucketed: readonly Entity[] | null = null;
  readonly captures: JournaledCaptures<true>;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
  ) {
    this.buckets = new NodeBuckets(world, []);
    this.captures = new JournaledCaptures<true>(
      world,
      {
        membership: [Stockpile, Position, Building, Upgrading, UnderConstruction],
        values: [Stockpile, Building, Upgrading],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e) => (isQualitySource(world, content, e) ? true : null),
        apply: (e) => {
          insertSortedById(this.ids, e, byId);
          this.frozen = null;
        },
        withdraw: (e) => {
          removeSortedById(this.ids, e, byId);
          this.frozen = null;
        },
        clear: () => {
          this.ids.length = 0;
          this.frozen = null;
        },
      },
    );
  }

  /** The sources as of the last catch-up, shared and frozen. */
  list(): readonly Entity[] {
    this.frozen ??= Object.freeze(this.ids.slice());
    return this.frozen;
  }

  /** `list`'s entities by node; `list` is one {@link list} returned. */
  bucketsOf(list: readonly Entity[]): NodeBuckets {
    if (this.bucketed !== list) {
      this.buckets.refill(this.world, list);
      this.bucketed = list;
    }
    return this.buckets;
  }

  verify(): string[] {
    this.captures.catchUp();
    const held = this.list();
    const fresh = this.world
      .canonicalQuery(Stockpile, Position)
      .filter((e) => isQualitySource(this.world, this.content, e));
    const same = fresh.length === held.length && fresh.every((e, i) => e === held[i]);
    return same ? [] : ['qualitySources disagree with a fresh store scan'];
  }
}

const sourcesByWorld = new WeakMap<World, QualitySources>();

/** The world's quality sources, caught up to the live world. */
function qualitySources(world: World, content: ContentSet): QualitySources {
  let held = sourcesByWorld.get(world);
  if (held === undefined || held.content !== content) {
    if (held === undefined) {
      world.registerCacheVerifier('qualitySources', () => sourcesByWorld.get(world)?.verify() ?? []);
    }
    held = new QualitySources(world, content);
    sourcesByWorld.set(world, held);
  } else {
    held.captures.catchUp();
  }
  return held;
}

const RING_MAX_RADIUS = 48;
const RING_MIN_CANDIDATES = 64;
