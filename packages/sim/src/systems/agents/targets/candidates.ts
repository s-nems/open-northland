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
import type { SystemContext } from '../../context.js';
import { canonicalResources } from '../../resource-index.js';
import { canonicalById } from '../../spatial.js';
import { isCarrierJob } from '../../stores.js';

/** Canonically ordered target categories shared by every settler planned during one tick. */
export interface TargetCandidates {
  /** Harvest targets: entities with {@link Resource} + {@link Position}. */
  readonly resources: readonly Entity[];
  /** Stores / food stores / workplace outputs: entities with {@link Stockpile} + {@link Position}. */
  readonly stockpiles: readonly Entity[];
  /** Building-keyed targets (temples): entities with {@link Building} + {@link Position}. */
  readonly buildings: readonly Entity[];
  /** Construction sites, kept separate so an idle world scans an empty list. */
  readonly constructionSites: readonly Entity[];
  /** Felled trunks and dropped-good piles, kept separate from persistent stores. */
  readonly groundDrops: readonly Entity[];
  /** Sown fields used by the farming planner. */
  readonly crops: readonly Entity[];
  /** Good type to its content-authored harvesting atomic. */
  readonly harvestAtomicByGood: ReadonlyMap<number, number>;
  /** Workplaces with a carrier bound to their transport slot. */
  readonly carrierSuppliedWorkplaces: ReadonlySet<Entity>;
}

/** Snapshot the planner's canonical target categories once for the tick. */
export function collectTargets(world: World, ctx: SystemContext): TargetCandidates {
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

  return {
    resources: canonicalResources(world),
    stockpiles: canonicalById(world.query(Stockpile, Position)),
    buildings: canonicalById(world.query(Building, Position)),
    constructionSites: canonicalById(world.query(UnderConstruction, Building, Position)),
    groundDrops: canonicalById(world.query(GroundDrop, Stockpile, Position)),
    crops: canonicalById(world.query(Crop, Position)),
    harvestAtomicByGood,
    carrierSuppliedWorkplaces,
  };
}
