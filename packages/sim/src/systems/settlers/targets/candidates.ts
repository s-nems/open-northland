import {
  Building,
  Crop,
  Damaged,
  GroundDrop,
  HarvestedBy,
  Palisade,
  Position,
  Resource,
  Stockpile,
  UnderConstruction,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { canonicalResources } from '../../spatial/resources.js';
import { TargetBands } from './bands.js';
import { InteractionCellIndex } from './cell-index.js';
import { fieldZones } from './field-zones.js';
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
  /** Stores / food stores / workplace outputs: entities with {@link Stockpile} + {@link Position}. */
  readonly stockpiles: readonly Entity[];
  /** {@link stockpiles} as a ring index keyed by interaction cell, for the nearest-store picks. */
  readonly stockpileCells: InteractionCellIndex;
  /** Building-keyed targets (prayer sites): entities with {@link Building} + {@link Position}. */
  readonly buildings: readonly Entity[];
  /** {@link buildings} as a ring index keyed by interaction cell, for the nearest-prayer-site pick. */
  readonly buildingCells: InteractionCellIndex;
  /** Construction sites, kept separate so an idle world scans an empty list. */
  readonly constructionSites: readonly Entity[];
  /** {@link constructionSites} as a ring index keyed by interaction cell, for the nearest-site picks. */
  readonly constructionSiteCells: InteractionCellIndex;
  /** Buildings carrying {@link Damaged}, as a ring index keyed by interaction cell, for the nearest-repair
   *  pick. Built on first ask, so a pass with no builder looking for repairs never scans them. */
  readonly repairSiteCells: InteractionCellIndex;
  /** Walls carrying {@link Damaged}, indexed like {@link repairSiteCells}; kept apart because builders
   *  mend walls only once no building site is left. */
  readonly wallRepairCells: InteractionCellIndex;
  /** Felled trunks and dropped-good piles, kept separate from persistent stores. */
  readonly groundDrops: readonly Entity[];
  /** {@link groundDrops} under every good each pile holds, ascending-id, so a scan for one good never
   *  visits the others. A superset for the pass: a ground drop only ever loses goods. */
  readonly groundDropsByGood: ReadonlyMap<number, readonly Entity[]>;
  /** {@link groundDrops} carrying a {@link HarvestedBy} mark, under the harvester it names, ascending-id. */
  readonly groundDropsByHarvester: ReadonlyMap<Entity, readonly Entity[]>;
  /** Sown fields grouped by the {@link Crop.farm} that owns them, each list ascending-id, so a farmer
   *  reads only its own farm's fields instead of the settlement's whole crop list. */
  readonly cropsByFarm: ReadonlyMap<Entity, readonly Entity[]>;
  /** Ground reserved by standing buildings, shared by all farmers choosing a sow node this tick. */
  readonly fieldZones: ReadonlySet<NodeId>;
  /** Good type to its content-authored harvesting atomic. */
  readonly harvestAtomicByGood: ReadonlyMap<number, number>;
  /** Position-independent store-capacity probes, memoized by good for this planner tick. */
  readonly sinks: SinkAvailability;
  /** Question-keyed candidate bands, each built at most once per tick and shared by every asker. */
  readonly bands: TargetBands;
  /** Shared dynamic blocks and ground-heap occupancy for every flag delivery planned this tick. */
  readonly yard: YardTargets;
}

/** Snapshot the planner's canonical target categories once for the tick.
 *
 *  The getters are memoized for the tick, so a view no settler asks for is never built. A first-access
 *  build matches a tick-start one: the pass sows, harvests and razes nothing, and its only stock writes
 *  are a farm's herd rows and drops onto a yard heap, which is why the yard occupancy is caught up here. */
export function collectTargets(world: World, ctx: SystemContext, terrain: TerrainGraph): TargetCandidates {
  const harvestAtomicByGood = new Map<number, number>();
  for (const good of ctx.content.goods) {
    if (good.atomics.harvest !== undefined) harvestAtomicByGood.set(good.typeId, good.atomics.harvest);
  }

  const stockpiles = world.canonicalQuery(Stockpile, Position);
  const buildings = world.canonicalQuery(Building, Position);
  const constructionSites = world.canonicalQuery(UnderConstruction, Position);
  let cropsByFarm: Map<Entity, Entity[]> | undefined;
  let stockpileCells: InteractionCellIndex | undefined;
  let buildingCells: InteractionCellIndex | undefined;
  let constructionSiteCells: InteractionCellIndex | undefined;
  let repairSiteCells: InteractionCellIndex | undefined;
  let wallRepairCells: InteractionCellIndex | undefined;
  let zones: ReadonlySet<NodeId> | undefined;
  const groundDrops = world.canonicalQuery(GroundDrop, Stockpile, Position);
  let groundDropsByGood: Map<number, Entity[]> | undefined;
  let groundDropsByHarvester: Map<Entity, Entity[]> | undefined;
  return {
    resources: canonicalResources(world),
    stockpiles,
    get stockpileCells() {
      stockpileCells ??= new InteractionCellIndex(world, ctx, terrain, stockpiles);
      return stockpileCells;
    },
    buildings,
    get buildingCells() {
      buildingCells ??= new InteractionCellIndex(world, ctx, terrain, buildings);
      return buildingCells;
    },
    constructionSites,
    get constructionSiteCells() {
      constructionSiteCells ??= new InteractionCellIndex(world, ctx, terrain, constructionSites);
      return constructionSiteCells;
    },
    get repairSiteCells() {
      repairSiteCells ??= new InteractionCellIndex(
        world,
        ctx,
        terrain,
        world.canonicalQuery(Damaged, Building, Position),
      );
      return repairSiteCells;
    },
    get wallRepairCells() {
      wallRepairCells ??= new InteractionCellIndex(
        world,
        ctx,
        terrain,
        world.canonicalQuery(Damaged, Palisade, Position),
      );
      return wallRepairCells;
    },
    groundDrops,
    get groundDropsByGood() {
      if (groundDropsByGood === undefined) {
        groundDropsByGood = new Map();
        for (const pile of groundDrops) {
          const { amounts } = world.get(pile, Stockpile);
          // keys() plus get: destructured entries would allocate a pair per line of every drop.
          for (const good of amounts.keys()) {
            if ((amounts.get(good) ?? 0) > 0) pushTo(groundDropsByGood, good, pile);
          }
        }
      }
      return groundDropsByGood;
    },
    get groundDropsByHarvester() {
      if (groundDropsByHarvester === undefined) {
        groundDropsByHarvester = new Map();
        for (const pile of groundDrops) {
          const mark = world.tryGet(pile, HarvestedBy);
          if (mark !== undefined) pushTo(groundDropsByHarvester, mark.by, pile);
        }
      }
      return groundDropsByHarvester;
    },
    get cropsByFarm() {
      if (cropsByFarm === undefined) {
        // Grouped from the canonical list, so each farm's fields stay ascending-id and the farmer's
        // tie-break picks the same field a whole-world scan would.
        cropsByFarm = new Map();
        for (const crop of world.canonicalQuery(Crop, Position)) {
          const farm = world.get(crop, Crop).farm;
          if (farm !== null) pushTo(cropsByFarm, farm, crop);
        }
      }
      return cropsByFarm;
    },
    get fieldZones() {
      zones ??= fieldZones(world, ctx.content, terrain);
      return zones;
    },
    harvestAtomicByGood,
    sinks: new SinkAvailability(stockpiles, world, ctx),
    bands: new TargetBands(world, ctx, terrain, stockpiles, buildings),
    yard: { blocked: dynamicBlockOverlay(world, ctx, terrain), occupied: yardOccupancy(world, terrain) },
  };
}

function pushTo<K>(lists: Map<K, Entity[]>, key: K, e: Entity): void {
  const list = lists.get(key);
  if (list === undefined) lists.set(key, [e]);
  else list.push(e);
}
