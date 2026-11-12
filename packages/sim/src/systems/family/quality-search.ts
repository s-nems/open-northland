import type { ContentSet } from '@open-northland/data';
import {
  Building,
  Owner,
  ownerOf,
  ownersCompatible,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { templeFuelSlotOf } from '../readviews/index.js';
import { interactionCell, unclaimedGoodsAt } from '../settlers/targets/index.js';
import { NodeBuckets } from '../spatial/nodes.js';
import { accessibleStockAmounts, type SupplyTally } from '../stores/index.js';
import { SidedCandidates, sidesMatch } from './candidate-sides.js';

/**
 * Per-tick searchable view of external stores carrying a configured household-quality good. The
 * candidates are the ones stocked at the last catch-up of the shared sources, which only a new view makes.
 * Their node buckets are kept while the list is
 * unchanged, which holds because a positioned stockpile never moves in place (`spatial/stockpiles.ts`).
 */
export class ExternalQualityIndex {
  private readonly sources: QualitySources;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph | undefined,
    private readonly supply: SupplyTally,
  ) {
    this.sources = qualitySources(world, ctx.content);
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
    // The ring rejects every other side's candidate, so a small side is judged faster by the linear scan.
    const side = this.onSide(owner);
    const ringed = side.length > RING_MIN_CANDIDATES;
    const hit = ringed ? this.bucketed().nearest(from.hx, from.hy, 0, RING_MAX_RADIUS, accept) : null;
    // A ring sweep that missed rejected every candidate inside its radius already.
    const store = hit?.entity ?? this.linearNearest(side, from, accept, ringed ? RING_MAX_RADIUS : -1);
    if (store === null) return null;
    const goodType = this.lowestDemanded(store, demanded);
    return goodType === null ? null : { store, goodType };
  }

  /** The candidates `owner` may take from, ascending id; `accept` still checks the side. */
  private onSide(owner: number | undefined): readonly Entity[] {
    return this.sources.onSide(owner);
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
    let bestDistance = 0;
    for (const store of candidates) {
      // A pile a placement earlier in this pass displaced is gone from the world but not from the list.
      const p = this.world.tryGet(store, Position);
      if (p === undefined) continue;
      const distance =
        Math.abs(nodeHxOfPosition(p.x, p.y) - from.hx) + Math.abs(nodeHyOfPosition(p.x, p.y) - from.hy);
      if (distance <= swept || (best !== null && distance >= bestDistance)) continue;
      if (accept(store)) {
        best = store;
        bestDistance = distance;
      }
    }
    return best;
  }

  private bucketed(): NodeBuckets {
    return this.sources.bucketsOf(this.sources.list());
  }

  /** The lowest demanded good `store` holds a unit of that no walker has claimed. */
  private lowestDemanded(store: Entity, demanded: ReadonlySet<number>): number | null {
    const { world, supply } = this;
    return lowestQualityGood(
      world,
      this.ctx.content,
      store,
      demanded,
      unclaimedGoodsAt(world, this.ctx, supply, store),
    );
  }
}

/** The lowest household-quality good `store` holds a unit of, among `demanded` when given and passing
 *  `accepts` when given; never a temple's fuel, which its fire keeps. A min over `keys()` plus `get`:
 *  destructured entries would allocate a pair per stock line of every candidate. */
function lowestQualityGood(
  world: World,
  content: ContentSet,
  store: Entity,
  demanded?: ReadonlySet<number>,
  accepts?: (goodType: number) => boolean,
): number | null {
  const amounts = accessibleStockAmounts(world, store);
  if (amounts === undefined) return null;
  const type = world.tryGet(store, Building)?.buildingType;
  const kept = type === undefined ? undefined : templeFuelSlotOf(content, type)?.goodType;
  let lowest: number | null = null;
  for (const goodType of amounts.keys()) {
    if ((amounts.get(goodType) ?? 0) <= 0 || (demanded !== undefined && !demanded.has(goodType))) continue;
    if (lowest !== null && goodType >= lowest) continue;
    if (goodType === kept || contentIndex(content).goods.get(goodType)?.homeQuality === undefined) continue;
    if (accepts === undefined || accepts(goodType)) lowest = goodType;
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

/** A quality source's owner, captured so a withdrawal finds its side after the store is gone. */
interface SourceSide {
  readonly owner: number | undefined;
}

/** One world's quality sources in ascending id, kept across ticks and caught up by {@link qualitySources}. */
class QualitySources {
  private readonly sides = new SidedCandidates();
  private shared: readonly Entity[] | null = null;
  /** Buckets of the list they were last filled from, refilled only when a different list is searched. */
  private readonly buckets: NodeBuckets;
  private bucketed: readonly Entity[] | null = null;
  readonly captures: JournaledCaptures<SourceSide>;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
  ) {
    this.buckets = new NodeBuckets(world, []);
    this.captures = new JournaledCaptures<SourceSide>(
      world,
      {
        membership: [Stockpile, Position, Building, Upgrading, UnderConstruction, Owner],
        values: [Stockpile, Building, Upgrading, Owner],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e) => (isQualitySource(world, content, e) ? { owner: ownerOf(world, e) } : null),
        apply: (e, side) => {
          this.sides.insert(e, side.owner);
          this.shared = null;
        },
        withdraw: (e, side) => {
          this.sides.remove(e, side.owner);
          this.shared = null;
        },
        clear: () => {
          this.sides.clear();
          this.shared = null;
        },
      },
    );
  }

  /** The sources as of the last catch-up, shared: a new array whenever the members change, so the
   *  buckets may key on its identity. */
  list(): readonly Entity[] {
    this.shared ??= this.sides.all.slice();
    return this.shared;
  }

  /** The sources `owner` may take from, ascending id; see {@link SidedCandidates.of}. */
  onSide(owner: number | undefined): readonly Entity[] {
    return this.sides.of(owner);
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
    if (!same) return ['qualitySources disagree with a fresh store scan'];
    return sidesMatch(this.world, fresh, this.sides) ? [] : ['qualitySources hold a store on a stale side'];
  }
}

const sourcesByWorld = new WeakMap<World, QualitySources>();
/** The world's quality sources, caught up to the live world. */
export function qualitySources(world: World, content: ContentSet): QualitySources {
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
const RING_MIN_CANDIDATES = 256;
