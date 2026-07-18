import {
  Building,
  Crop,
  GroundDrop,
  JobAssignment,
  Position,
  Resource,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { canonicalResources } from '../../resource-index.js';
import { canonicalById } from '../../spatial.js';
import { isCarrierJob, isYardHeap, lowestStockedGood } from '../../stores/index.js';
import { InteractionCellIndex } from './cell-index.js';
import { SinkAvailability } from './stores/sinks.js';

export interface YardTargets {
  readonly blocked: BlockOverlay;
  readonly occupied: ReadonlyMap<NodeId, { readonly good: number; readonly fill: number }>;
}

/** Canonically ordered target categories shared by every settler planned during one tick. */
export interface TargetCandidates {
  /** Harvest targets: entities with {@link Resource} + {@link Position}. */
  readonly resources: readonly Entity[];
  /** Stores / food stores / workplace outputs: entities with {@link Stockpile} + {@link Position}. */
  readonly stockpiles: readonly Entity[];
  /** {@link stockpiles} as a ring index keyed by interaction cell, for the nearest-store picks.
   *  Built lazily by the first accessor (see {@link collectTargets}). */
  readonly stockpileCells: InteractionCellIndex;
  /** Building-keyed targets (temples): entities with {@link Building} + {@link Position}. */
  readonly buildings: readonly Entity[];
  /** {@link buildings} as a ring index keyed by interaction cell, for the nearest-temple pick.
   *  Built lazily by the first accessor (see {@link collectTargets}). */
  readonly buildingCells: InteractionCellIndex;
  /** Construction sites, kept separate so an idle world scans an empty list. */
  readonly constructionSites: readonly Entity[];
  /** {@link constructionSites} as a ring index keyed by interaction cell, for the nearest-site picks.
   *  Built lazily by the first accessor (see {@link collectTargets}). */
  readonly constructionSiteCells: InteractionCellIndex;
  /** Felled trunks and dropped-good piles, kept separate from persistent stores. */
  readonly groundDrops: readonly Entity[];
  /** Sown fields grouped by the {@link Crop.farm} that owns them, each list ascending-id — so a farmer
   *  reads only its own farm's fields instead of filtering the settlement's whole crop list per tick. */
  readonly cropsByFarm: ReadonlyMap<Entity, readonly Entity[]>;
  /** Good type to its content-authored harvesting atomic. */
  readonly harvestAtomicByGood: ReadonlyMap<number, number>;
  /** Workplaces with a carrier bound to their transport slot. */
  readonly carrierSuppliedWorkplaces: ReadonlySet<Entity>;
  /** Position-independent store-capacity probes, memoized by good for this planner tick. */
  readonly sinks: SinkAvailability;
  /** Shared dynamic blocks and ground-heap occupancy for every flag delivery planned this tick. */
  readonly yard: YardTargets;
}

/** Snapshot the planner's canonical target categories once for the tick.
 *
 *  The three {@link InteractionCellIndex}es are lazy getters memoized for the tick (the
 *  `FarmClaims.sowScan` shape), so a tick where no settler asks for a nearest store / temple / site
 *  never constructs that index. Deferring the build cannot move a pick: each index is built from the
 *  eager candidate list here, and its constructor reads only `Building` + `Position` + the content
 *  footprint — none of which the planner pass mutates — so the first-access build is byte-identical
 *  to a tick-start build. */
export function collectTargets(world: World, ctx: SystemContext, terrain: TerrainGraph): TargetCandidates {
  const harvestAtomicByGood = new Map<number, number>();
  for (const good of ctx.content.goods) {
    if (good.atomics.harvest !== undefined) harvestAtomicByGood.set(good.typeId, good.atomics.harvest);
  }

  const carrierSuppliedWorkplaces = new Set<Entity>();
  for (const entity of world.query(Settler, JobAssignment)) {
    const jobType = world.get(entity, Settler).jobType;
    if (jobType === null || !isCarrierJob(ctx, jobType)) continue;
    carrierSuppliedWorkplaces.add(world.get(entity, JobAssignment).workplace);
  }

  const stockpiles = canonicalById(world.query(Stockpile, Position));
  const yardOccupied = new Map<NodeId, { good: number; fill: number }>();
  for (const entity of stockpiles) {
    if (!isYardHeap(world, entity)) continue;
    const stock = world.get(entity, Stockpile);
    const good = lowestStockedGood(stock);
    if (good === null) continue;
    const p = world.get(entity, Position);
    const node = nodeOfPosition(p.x, p.y);
    yardOccupied.set(terrain.nodeAtClamped(node.hx, node.hy), {
      good,
      fill: stock.amounts.get(good) ?? 0,
    });
  }
  const buildings = canonicalById(world.query(Building, Position));
  const constructionSites = canonicalById(world.query(UnderConstruction, Building, Position));
  // Grouped from the canonical list, so each farm's fields stay ascending-id and the farmer's
  // (distance, cell-id) tie-break picks the same field it did over the whole-world scan.
  const cropsByFarm = new Map<Entity, Entity[]>();
  for (const crop of canonicalById(world.query(Crop, Position))) {
    const farm = world.get(crop, Crop).farm;
    const fields = cropsByFarm.get(farm);
    if (fields === undefined) cropsByFarm.set(farm, [crop]);
    else fields.push(crop);
  }
  let stockpileCells: InteractionCellIndex | undefined;
  let buildingCells: InteractionCellIndex | undefined;
  let constructionSiteCells: InteractionCellIndex | undefined;
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
    groundDrops: canonicalById(world.query(GroundDrop, Stockpile, Position)),
    cropsByFarm,
    harvestAtomicByGood,
    carrierSuppliedWorkplaces,
    sinks: new SinkAvailability(stockpiles, world, ctx),
    yard: { blocked: dynamicBlockOverlay(world, ctx, terrain), occupied: yardOccupied },
  };
}
