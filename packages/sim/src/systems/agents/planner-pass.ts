import type { World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { ExternalFoodIndex } from '../family/food-search.js';
import { GossipCandidates } from '../social/index.js';
import { collectInboundSupply, type InboundSupplyTally } from '../stores/index.js';
import { collectHarvestClaims, type HarvestClaims } from './economy/harvest-claims.js';
import { SiteLeads, type WorkSeatClaims } from './economy/index.js';
import { collectFarmClaims, type FarmClaims } from './farming/index.js';
import { PlannerSpacing } from './planner-spacing.js';
import { collectTargets, hasHaulableOutput, type TargetCandidates } from './targets/index.js';

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
    targets,
    anyHaulable: hasHaulableOutput(world, ctx, targets.stockpiles),
    externalFood: new ExternalFoodIndex(world, ctx, terrain),
    spacing: PlannerSpacing.forTick(world, ctx, terrain),
    farmClaims: collectFarmClaims(world),
    seatClaims: new Map(),
    inbound: collectInboundSupply(world),
    harvestClaims: collectHarvestClaims(world),
    gossipCandidates: new GossipCandidates(world),
    siteLeads: new SiteLeads(world),
  };
}
