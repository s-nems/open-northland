import { Position, Stockpile } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { BattleFront } from '../../conflict/battle-alert.js';
import type { SystemContext } from '../../context.js';
import { collectShelters, type ShelterSites } from '../../defence/index.js';
import { ExternalFoodIndex } from '../../family/food-search.js';
import { ExternalQualityIndex } from '../../family/quality-search.js';
import { GossipCandidates } from '../../social/index.js';
import { collectSupplyTally, type SupplyTally } from '../../stores/index.js';
import { SeatDoors } from '../drives/cut-off.js';
import { collectHarvestClaims, type HarvestClaims } from '../drives/economy/harvest-claims.js';
import { ConstructionTaskClaims, RepairCrews, WorkSeatClaims } from '../drives/economy/index.js';
import { collectFarmClaims, type FarmClaims } from '../drives/farming/index.js';
import { HomewardPosts } from '../drives/lost-guide.js';
import { collectTargets, hasHaulableOutput, type TargetCandidates } from '../targets/index.js';
import { IdleStands } from './idle-replan.js';
import { standsThroughPass } from './replan.js';
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
  readonly targets: TargetCandidates;
  /** Whether any workplace holds a haulable output: the tick-level dormancy gate for the store-carrier
   *  fallback scan. */
  readonly anyHaulable: boolean;
  readonly externalFood: ExternalFoodIndex;
  readonly externalQuality: ExternalQualityIndex;
  readonly spacing: PlannerSpacing;
  readonly farmClaims: FarmClaims;
  readonly seatClaims: WorkSeatClaims;
  readonly supply: SupplyTally;
  readonly harvestClaims: HarvestClaims;
  readonly gossipCandidates: GossipCandidates;
  readonly front: BattleFront;
  readonly constructionClaims: ConstructionTaskClaims;
  readonly repairCrews: RepairCrews;
  readonly seatDoors: SeatDoors;
  readonly homeward: HomewardPosts;
  /** The buildings on alarm and the room each has left, empty on a map with no defence mode up, which
   *  is what makes the shelter rung free when nothing is happening. */
  readonly shelters: ShelterSites;
  /** The adults whose ladder found them nothing to do this pass, so they stand. */
  readonly idle: IdleStands;
}

/** Snapshot the shared pass state at the top of a planner tick. */
export function beginPlannerPass(world: World, ctx: SystemContext, terrain: TerrainGraph): PlannerPass {
  const targets = collectTargets(world, ctx, terrain);
  const front = new BattleFront(world, ctx);
  const shelters = collectShelters(world, ctx);
  const seatDoors = new SeatDoors(world, ctx, terrain, targets.buildings);
  return {
    world,
    ctx,
    terrain,
    targets,
    // Any one store answers, so the stores need no canonical order.
    anyHaulable: hasHaulableOutput(world, ctx, world.query(Stockpile, Position)),
    externalFood: new ExternalFoodIndex(world, ctx, terrain),
    externalQuality: new ExternalQualityIndex(world, ctx, terrain),
    spacing: PlannerSpacing.forTick(world, ctx, terrain),
    farmClaims: collectFarmClaims(world),
    seatClaims: new WorkSeatClaims((e) => standsThroughPass(world, ctx, shelters, e)),
    supply: collectSupplyTally(world),
    harvestClaims: collectHarvestClaims(world),
    gossipCandidates: new GossipCandidates(world, ctx.content),
    front,
    constructionClaims: new ConstructionTaskClaims(world, ctx),
    repairCrews: new RepairCrews(world, ctx, front),
    seatDoors,
    homeward: new HomewardPosts(world, terrain, seatDoors),
    shelters,
    idle: new IdleStands(),
  };
}
