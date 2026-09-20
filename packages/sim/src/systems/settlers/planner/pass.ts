import { Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { collectShelters, type ShelterSites } from '../../defence/index.js';
import { ExternalFoodIndex } from '../../family/food-search.js';
import { ExternalQualityIndex } from '../../family/quality-search.js';
import { GossipCandidates } from '../../social/index.js';
import { canonicalById } from '../../spatial/nodes.js';
import { collectInboundSupply, type InboundSupplyTally } from '../../stores/index.js';
import { SeatDoors } from '../drives/cut-off.js';
import { collectHarvestClaims, type HarvestClaims } from '../drives/economy/harvest-claims.js';
import { SiteLeads, type WorkSeatClaims } from '../drives/economy/index.js';
import { collectFarmClaims, type FarmClaims } from '../drives/farming/index.js';
import { collectTargets, hasHaulableOutput, type TargetCandidates } from '../targets/index.js';
import { PlannerSpacing } from './spacing.js';

/**
 * The state one atomic-planner pass shares across every settler it plans this tick: the world and tick
 * inputs, the canonical target snapshot with its per-tick indexes, and the claim state the pass's picks
 * accumulate into. Each index is built at most once per tick.
 */
export interface PlannerPass {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  /** Every positioned settler in ascending entity-id order, shared by the assistant dispatch and the
   *  ladder sweep: the per-tick claim maps hand out targets first come, first served, so visit order
   *  decides who gets what. Wildlife is in this list: the sweep's `releaseStaleIntent` is the only
   *  failed-route recovery a parked creature has. */
  readonly settlers: readonly Entity[];
  readonly targets: TargetCandidates;
  /** Whether any workplace holds a haulable output: the tick-level dormancy gate for the store-carrier
   *  fallback scan. */
  readonly anyHaulable: boolean;
  readonly externalFood: ExternalFoodIndex;
  readonly externalQuality: ExternalQualityIndex;
  readonly spacing: PlannerSpacing;
  readonly farmClaims: FarmClaims;
  readonly seatClaims: WorkSeatClaims;
  readonly inbound: InboundSupplyTally;
  readonly harvestClaims: HarvestClaims;
  readonly gossipCandidates: GossipCandidates;
  readonly siteLeads: SiteLeads;
  readonly seatDoors: SeatDoors;
  /** The buildings on alarm and the room each has left, empty on a map with no defence mode up, which
   *  is what makes the shelter rung free when nothing is happening. */
  readonly shelters: ShelterSites;
  /** The settlers whose ladder reached its idle tail this pass: nothing to do, so they stand. */
  readonly standing: Set<Entity>;
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
    externalQuality: new ExternalQualityIndex(world, ctx, terrain),
    spacing: PlannerSpacing.forTick(world, ctx, terrain),
    farmClaims: collectFarmClaims(world),
    seatClaims: new Map(),
    inbound: collectInboundSupply(world),
    harvestClaims: collectHarvestClaims(world),
    gossipCandidates: new GossipCandidates(world, ctx.content),
    siteLeads: new SiteLeads(world),
    seatDoors: new SeatDoors(world, ctx, terrain, targets.buildings),
    shelters: collectShelters(world, ctx),
    standing: new Set(),
  };
}
