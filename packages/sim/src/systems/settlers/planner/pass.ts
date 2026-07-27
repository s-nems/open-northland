import { Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { ExternalFoodIndex } from '../../family/food-search.js';
import { GossipCandidates } from '../../social/index.js';
import { canonicalById } from '../../spatial/nodes.js';
import { collectInboundSupply, type InboundSupplyTally } from '../../stores/index.js';
import { collectHarvestClaims, type HarvestClaims } from '../economy/harvest-claims.js';
import { SiteLeads, type WorkSeatClaims } from '../economy/index.js';
import { collectFarmClaims, type FarmClaims } from '../farming/index.js';
import { collectTargets, hasHaulableOutput, type TargetCandidates } from '../targets/index.js';
import { PlannerSpacing } from './spacing.js';

/**
 * The state one atomic-planner pass shares across every settler it plans this tick: the world/tick
 * inputs, the canonical target snapshot and lazy per-tick indexes (each built at most once, so a
 * drive's scan is O(candidates) instead of a per-settler world re-scan), and the claim state the
 * pass's picks accumulate into. What each member reserves or indexes is documented on its type.
 */
export interface PlannerPass {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  /** Every positioned settler in canonical (ascending entity-id) order - the assistant dispatch and
   *  the ladder sweep share one sort, and both must visit in id order because the per-tick claim
   *  maps and the fetch reservations hand out targets first-come-first-served. */
  readonly settlers: readonly Entity[];
  readonly targets: TargetCandidates;
  /** Whether any workplace holds a haulable output: the tick-level dormancy gate for the
   *  store-carrier fallback scan (see {@link hasHaulableOutput}). */
  readonly anyHaulable: boolean;
  readonly externalFood: ExternalFoodIndex;
  readonly spacing: PlannerSpacing;
  readonly farmClaims: FarmClaims;
  readonly seatClaims: WorkSeatClaims;
  readonly inbound: InboundSupplyTally;
  readonly harvestClaims: HarvestClaims;
  readonly gossipCandidates: GossipCandidates;
  readonly siteLeads: SiteLeads;
}

/** Snapshot the shared pass state at the top of a planner tick. */
export function beginPlannerPass(world: World, ctx: SystemContext, terrain: TerrainGraph): PlannerPass {
  const targets = collectTargets(world, ctx, terrain);
  return {
    world,
    ctx,
    terrain,
    settlers: canonicalById(world.query(Settler, Position)),
    targets,
    anyHaulable: hasHaulableOutput(world, ctx, targets.stockpiles),
    externalFood: new ExternalFoodIndex(world, ctx, terrain),
    spacing: PlannerSpacing.forTick(world, ctx, terrain),
    farmClaims: collectFarmClaims(world),
    seatClaims: new Map(),
    inbound: collectInboundSupply(world),
    harvestClaims: collectHarvestClaims(world),
    gossipCandidates: new GossipCandidates(world, ctx.content),
    siteLeads: new SiteLeads(world),
  };
}
