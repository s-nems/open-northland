import {
  Building,
  Crop,
  GroundDrop,
  HarvestedBy,
  Palisade,
  Position,
  Resource,
  Stockpile,
  UnderConstruction,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { includesSortedId, ownId } from '../../../core/sorted-id.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { canonicalResources } from '../../spatial/resources.js';
import { TargetBands } from './bands.js';
import { InteractionCellIndex } from './cell-index.js';
import { constructionSiteCells, isServedConstructionSite } from './construction-site-cells.js';
import { cropsByFarm } from './crops-by-farm.js';
import { fieldZones, type NodeMembership } from './field-zones.js';
import { harvesterMarks } from './harvester-marks.js';
import { mealCells } from './meal-cells.js';
import { repairSiteCells } from './repair-site-cells.js';
import { roadSiteCells as roadSiteCellsOf } from './road-site-cells.js';
import { stockpileCells } from './stockpile-cells.js';
import { SinkAvailability } from './stores/sinks.js';
import { yardOccupancy } from './yard-occupancy.js';

export interface YardTargets {
  readonly blocked: BlockOverlay;
  /** Per yard-heap node: the good it holds and how full it is, so the yard steering can tell a tile that
   *  still takes a unit from one `stackOntoTile` would refuse. */
  readonly occupied: ReadonlyMap<NodeId, { readonly good: number; readonly fill: number }>;
}

/** Canonically ordered target categories shared by every settler planned during one tick. */
export interface TargetCandidates {
  /** Harvest targets: entities with {@link Resource} + {@link Position}. */
  readonly resources: readonly Entity[];
  /** Stores / food stores / workplace outputs, the entities with {@link Stockpile} + {@link Position}, as a
   *  ring index keyed by interaction cell for the nearest-store picks. Kept across ticks and caught up
   *  here, so it holds the stockpiles standing at the pass's start. */
  readonly stockpileCells: InteractionCellIndex;
  /** Stocks and wild fruit in one meal index the hunger rung searches in tiers, built lazily and kept
   *  across ticks. */
  readonly mealCells: InteractionCellIndex;
  /** Building-keyed targets (prayer sites): entities with {@link Building} + {@link Position}. */
  readonly buildings: readonly Entity[];
  /** Building construction sites builders and haulers serve, kept separate so an idle world scans an
   *  empty list. A vehicle house's hidden site is not among them: only the workshop worker raising it
   *  crews it. */
  readonly constructionSites: readonly Entity[];
  /** {@link constructionSites} as a ring index keyed by interaction cell, for the nearest-site picks. Kept
   *  across ticks and caught up with the site lists. */
  readonly constructionSiteCells: InteractionCellIndex;
  /** Unfinished wall segments, indexed apart from {@link constructionSiteCells}: builders take them only
   *  once no building site is left, and only a segment's own builder supplies it. */
  readonly wallSiteCells: InteractionCellIndex;
  /** The road sites, indexed like {@link wallSiteCells} but kept across ticks. */
  readonly roadSiteCells: InteractionCellIndex;
  /** Buildings carrying {@link Damaged}, as a ring index keyed by interaction cell, for the nearest-repair
   *  pick. Kept across ticks and caught up on first ask. */
  readonly repairSiteCells: InteractionCellIndex;
  /** Walls carrying {@link Damaged}, indexed like {@link repairSiteCells}; kept apart because builders
   *  mend walls only once no building site is left. */
  readonly wallRepairCells: InteractionCellIndex;
  /** The unfinished vehicle sites, for the yard drive's reuse pick. Mutable: the drive appends a site it
   *  opens, so a workmate planned later in the same pass reuses it instead of opening its own. */
  readonly vehicleSites: Entity[];
  /** Felled trunks and dropped-good piles, kept separate from persistent stores. */
  readonly groundDrops: readonly Entity[];
  /** {@link groundDrops} under every good each pile holds, ascending-id, so a scan for one good never
   *  visits the others. A superset for the pass: a ground drop only ever loses goods. */
  readonly groundDropsByGood: ReadonlyMap<number, readonly Entity[]>;
  /** The {@link groundDrops} whose {@link HarvestedBy} mark names `harvester`, ascending-id, or undefined
   *  for none. */
  ownDropsOf(harvester: Entity): readonly Entity[] | undefined;
  /** Sown fields grouped by the {@link Crop.farm} that owns them, each list ascending-id, so a farmer
   *  reads only its own farm's fields instead of the settlement's whole crop list. */
  readonly cropsByFarm: ReadonlyMap<Entity, readonly Entity[]>;
  /** Ground reserved by standing buildings, shared by all farmers choosing a sow node this tick. */
  readonly fieldZones: NodeMembership;
  /** Good type to its content-authored harvesting atomic. */
  readonly harvestAtomicByGood: ReadonlyMap<number, number>;
  /** Position-independent store-capacity probes, memoized by good for this planner tick. */
  readonly sinks: SinkAvailability;
  /** Question-keyed candidate bands, each built at most once per tick and shared by every asker. */
  readonly bands: TargetBands;
  /** Shared dynamic blocks and ground-heap occupancy for every flag delivery planned this tick. */
  readonly yard: YardTargets;
}

interface SiteSplit {
  readonly construction: readonly Entity[];
  readonly vehicle: Entity[];
  readonly cells: InteractionCellIndex;
}

/** The construction sites split into the vehicle sites and the rest; the rest is the shared canonical
 *  list itself while no vehicle site stands. */
function splitVehicleSites(world: World, ctx: SystemContext): Omit<SiteSplit, 'cells'> {
  const sites = world.canonicalQuery(UnderConstruction, Building, Position);
  const vehicle: Entity[] = [];
  for (let i = 0; i < sites.length; i++) {
    const e = sites[i] as Entity;
    if (!isServedConstructionSite(world, ctx.content, e)) vehicle.push(e);
  }
  if (vehicle.length === 0) return { construction: sites, vehicle };
  return { construction: sites.filter((e) => isServedConstructionSite(world, ctx.content, e)), vehicle };
}

/** Snapshot the planner's canonical target categories once for the tick.
 *
 *  The getters are memoized for the tick, so a view no settler asks for is never built. A first-access
 *  build matches a tick-start one: the pass sows, harvests and razes nothing, and its only stock writes
 *  are a farm's herd rows and drops onto a yard heap, which is why the yard occupancy is caught up here. */
export function collectTargets(world: World, ctx: SystemContext, terrain: TerrainGraph): TargetCandidates {
  return new TickTargets(world, ctx, terrain);
}

/** {@link TargetCandidates} as a class: its lazy views are prototype getters, so a pass allocates one
 *  object instead of a fresh closure and accessor shape per view. */
class TickTargets implements TargetCandidates {
  readonly stockpileCells: InteractionCellIndex;
  readonly buildings: readonly Entity[];
  readonly groundDrops: readonly Entity[];
  readonly harvestAtomicByGood: ReadonlyMap<number, number>;
  readonly sinks: SinkAvailability;
  readonly bands: TargetBands;
  readonly yard: YardTargets;
  private mealCellsMemo: InteractionCellIndex | undefined;
  private resourcesMemo: readonly Entity[] | undefined;
  private sites: SiteSplit | undefined;
  private cropsByFarmMemo: ReadonlyMap<Entity, readonly Entity[]> | undefined;
  private wallSiteCellsMemo: InteractionCellIndex | undefined;
  private roadSiteCellsMemo: InteractionCellIndex | undefined;
  private repairSiteCellsMemo: InteractionCellIndex | undefined;
  private wallRepairCellsMemo: InteractionCellIndex | undefined;
  private zones: NodeMembership | undefined;
  private groundDropsByGoodMemo: Map<number, Entity[]> | undefined;
  private harvesterMarksMemo: ReadonlyMap<Entity, readonly Entity[]> | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
  ) {
    this.harvestAtomicByGood = contentIndex(ctx.content).harvestAtomicByGood;
    this.buildings = world.canonicalQuery(Building, Position);
    this.groundDrops = world.canonicalQuery(GroundDrop, Stockpile, Position);
    this.stockpileCells = stockpileCells(world, ctx.content, terrain);
    this.sinks = new SinkAvailability(world, ctx);
    this.bands = new TargetBands(world, ctx, terrain, this.buildings);
    this.yard = {
      blocked: dynamicBlockOverlay(world, ctx, terrain),
      occupied: yardOccupancy(world, terrain),
    };
  }

  get mealCells(): InteractionCellIndex {
    this.mealCellsMemo ??= mealCells(this.world, this.ctx.content, this.terrain);
    return this.mealCellsMemo;
  }

  /** Read on first ask: the canonical list is copied for its readers whenever a resource comes or goes,
   *  and most passes run no unbounded harvest scan. The pass fells and plants nothing, so a late read
   *  sees the tick-start list. */
  get resources(): readonly Entity[] {
    this.resourcesMemo ??= canonicalResources(this.world);
    return this.resourcesMemo;
  }

  /** The site lists and the held site index, caught up together so the index holds the listed sites. */
  private siteSplit(): SiteSplit {
    this.sites ??= {
      ...splitVehicleSites(this.world, this.ctx),
      cells: constructionSiteCells(this.world, this.ctx.content, this.terrain),
    };
    return this.sites;
  }

  get constructionSites(): readonly Entity[] {
    return this.siteSplit().construction;
  }

  get vehicleSites(): Entity[] {
    return this.siteSplit().vehicle;
  }

  get constructionSiteCells(): InteractionCellIndex {
    return this.siteSplit().cells;
  }

  get wallSiteCells(): InteractionCellIndex {
    this.wallSiteCellsMemo ??= this.indexOver(
      this.world.canonicalQuery(UnderConstruction, Palisade, Position),
    );
    return this.wallSiteCellsMemo;
  }

  get roadSiteCells(): InteractionCellIndex {
    this.roadSiteCellsMemo ??= roadSiteCellsOf(this.world, this.ctx, this.terrain);
    return this.roadSiteCellsMemo;
  }

  get repairSiteCells(): InteractionCellIndex {
    this.repairSiteCellsMemo ??= repairSiteCells(this.world, this.ctx.content, this.terrain, 'building');
    return this.repairSiteCellsMemo;
  }

  get wallRepairCells(): InteractionCellIndex {
    this.wallRepairCellsMemo ??= repairSiteCells(this.world, this.ctx.content, this.terrain, 'wall');
    return this.wallRepairCellsMemo;
  }

  get groundDropsByGood(): ReadonlyMap<number, readonly Entity[]> {
    if (this.groundDropsByGoodMemo === undefined) {
      const byGood = new Map<number, Entity[]>();
      const { world, groundDrops } = this;
      for (let i = 0; i < groundDrops.length; i++) {
        const pile = groundDrops[i];
        if (pile === undefined) continue;
        // A placement earlier in the pass may have displaced the pile, which re-creates it under a new id.
        const amounts = world.tryGet(pile, Stockpile)?.amounts;
        if (amounts === undefined) continue;
        // keys() plus get: destructured entries would allocate a pair per line of every drop.
        for (const good of amounts.keys()) {
          if ((amounts.get(good) ?? 0) > 0) pushTo(byGood, good, pile);
        }
      }
      this.groundDropsByGoodMemo = byGood;
    }
    return this.groundDropsByGoodMemo;
  }

  ownDropsOf(harvester: Entity): readonly Entity[] | undefined {
    // Caught up on the pass's first ask, like the views above, and narrowed to the drops of the pass start.
    this.harvesterMarksMemo ??= harvesterMarks(this.world);
    const marked = this.harvesterMarksMemo.get(harvester);
    if (marked === undefined) return undefined;
    const drops = this.groundDrops;
    for (let i = 0; i < marked.length; i++) {
      if (!includesSortedId(drops, marked[i] as Entity, ownId)) {
        const standing = marked.filter((e) => includesSortedId(drops, e, ownId));
        return standing.length === 0 ? undefined : standing;
      }
    }
    return marked;
  }

  get cropsByFarm(): ReadonlyMap<Entity, readonly Entity[]> {
    this.cropsByFarmMemo ??= cropsByFarm(this.world);
    return this.cropsByFarmMemo;
  }

  get fieldZones(): NodeMembership {
    this.zones ??= fieldZones(this.world, this.ctx.content, this.terrain);
    return this.zones;
  }

  private indexOver(candidates: readonly Entity[]): InteractionCellIndex {
    return new InteractionCellIndex(this.world, this.ctx, this.terrain, candidates);
  }
}

function pushTo<K>(lists: Map<K, Entity[]>, key: K, e: Entity): void {
  const list = lists.get(key);
  if (list === undefined) lists.set(key, [e]);
  else list.push(e);
}
