import {
  Building,
  Crop,
  GroundDrop,
  Position,
  Resource,
  Stockpile,
  UnderConstruction,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingFieldZone, translatedCells } from '../../footprint/geometry.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { canonicalById } from '../../spatial/nodes.js';
import { canonicalResources } from '../../spatial/resources.js';
import { isYardHeap, lowestStockedGood } from '../../stores/index.js';
import { TargetBands } from './bands.js';
import { InteractionCellIndex } from './cell-index.js';
import { SinkAvailability } from './stores/sinks.js';

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
 *  The {@link InteractionCellIndex} getters are memoized for the tick, so an index no settler asks for
 *  is never built. Deferring cannot move a pick: an index reads only the eager candidate list and state
 *  the planner pass does not mutate, so a first-access build matches a tick-start one. */
export function collectTargets(world: World, ctx: SystemContext, terrain: TerrainGraph): TargetCandidates {
  const harvestAtomicByGood = new Map<number, number>();
  for (const good of ctx.content.goods) {
    if (good.atomics.harvest !== undefined) harvestAtomicByGood.set(good.typeId, good.atomics.harvest);
  }

  const stockpiles = canonicalById(world.query(Stockpile, Position));
  const yardOccupied = new Map<NodeId, { good: number; fill: number }>();
  for (const entity of stockpiles) {
    if (!isYardHeap(world, entity)) continue;
    const stock = world.get(entity, Stockpile);
    const good = lowestStockedGood(stock);
    if (good === null) continue;
    const p = world.get(entity, Position);
    yardOccupied.set(terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y)), {
      good,
      fill: stock.amounts.get(good) ?? 0,
    });
  }
  const buildings = canonicalById(world.query(Building, Position));
  const constructionSites = canonicalById(world.query(UnderConstruction, Building, Position));
  // Grouped from the canonical list, so each farm's fields stay ascending-id and the farmer's
  // tie-break picks the same field a whole-world scan would.
  const cropsByFarm = new Map<Entity, Entity[]>();
  for (const crop of canonicalById(world.query(Crop, Position))) {
    const farm = world.get(crop, Crop).farm;
    if (farm === null) continue;
    const fields = cropsByFarm.get(farm);
    if (fields === undefined) cropsByFarm.set(farm, [crop]);
    else fields.push(crop);
  }
  let stockpileCells: InteractionCellIndex | undefined;
  let buildingCells: InteractionCellIndex | undefined;
  let constructionSiteCells: InteractionCellIndex | undefined;
  let fieldZones: Set<NodeId> | undefined;
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
    get fieldZones() {
      if (fieldZones === undefined) {
        fieldZones = new Set<NodeId>();
        for (const entity of buildings) {
          const building = world.get(entity, Building);
          const position = world.get(entity, Position);
          const anchor = nodeOfPosition(position.x, position.y);
          for (const cell of translatedCells(
            terrain,
            buildingFieldZone(ctx.content, building.buildingType),
            anchor.hx,
            anchor.hy,
          ))
            fieldZones.add(cell);
        }
      }
      return fieldZones;
    },
    harvestAtomicByGood,
    sinks: new SinkAvailability(stockpiles, world, ctx),
    bands: new TargetBands(world, ctx, terrain, stockpiles, buildings),
    yard: { blocked: dynamicBlockOverlay(world, ctx, terrain), occupied: yardOccupied },
  };
}
