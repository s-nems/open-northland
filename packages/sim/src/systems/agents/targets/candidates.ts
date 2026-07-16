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
  /** {@link stockpiles} as a ring index keyed by interaction cell, for the nearest-store picks. */
  readonly stockpileCells: InteractionCellIndex;
  /** Building-keyed targets (temples): entities with {@link Building} + {@link Position}. */
  readonly buildings: readonly Entity[];
  /** {@link buildings} as a ring index keyed by interaction cell, for the nearest-temple pick. */
  readonly buildingCells: InteractionCellIndex;
  /** Construction sites, kept separate so an idle world scans an empty list. */
  readonly constructionSites: readonly Entity[];
  /** {@link constructionSites} as a ring index keyed by interaction cell, for the nearest-site picks. */
  readonly constructionSiteCells: InteractionCellIndex;
  /** Felled trunks and dropped-good piles, kept separate from persistent stores. */
  readonly groundDrops: readonly Entity[];
  /** Sown fields used by the farming planner. */
  readonly crops: readonly Entity[];
  /** Good type to its content-authored harvesting atomic. */
  readonly harvestAtomicByGood: ReadonlyMap<number, number>;
  /** Workplaces with a carrier bound to their transport slot. */
  readonly carrierSuppliedWorkplaces: ReadonlySet<Entity>;
  /** Position-independent store-capacity probes, memoized by good for this planner tick. */
  readonly sinks: SinkAvailability;
  /** Shared dynamic blocks and ground-heap occupancy for every flag delivery planned this tick. */
  readonly yard: YardTargets;
}

/** Snapshot the planner's canonical target categories once for the tick. */
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
  return {
    resources: canonicalResources(world),
    stockpiles,
    stockpileCells: new InteractionCellIndex(world, ctx, terrain, stockpiles),
    buildings,
    buildingCells: new InteractionCellIndex(world, ctx, terrain, buildings),
    constructionSites,
    constructionSiteCells: new InteractionCellIndex(world, ctx, terrain, constructionSites),
    groundDrops: canonicalById(world.query(GroundDrop, Stockpile, Position)),
    crops: canonicalById(world.query(Crop, Position)),
    harvestAtomicByGood,
    carrierSuppliedWorkplaces,
    sinks: new SinkAvailability(stockpiles, world, ctx),
    yard: { blocked: dynamicBlockOverlay(world, ctx, terrain), occupied: yardOccupied },
  };
}
