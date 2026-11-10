import { Position, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { BattleFront, holdsGround } from '../../conflict/battle-alert.js';
import type { SystemContext } from '../../context.js';
import { collectShelters, type ShelterSites } from '../../defence/index.js';
import { ExternalFoodIndex } from '../../family/food-search.js';
import { ExternalQualityIndex } from '../../family/quality-search.js';
import { GossipCandidates } from '../../social/index.js';
import { collectSupplyTally, type SupplyTally } from '../../stores/index.js';
import { SeatDoors } from '../drives/cut-off.js';
import { collectHarvestClaims, type HarvestClaims } from '../drives/economy/harvest-claims.js';
import {
  ConstructionTaskClaims,
  RepairCrews,
  SiteSupplyReach,
  WorkSeatClaims,
} from '../drives/economy/index.js';
import { collectFarmClaims, type FarmClaims } from '../drives/farming/index.js';
import { HomewardPosts } from '../drives/lost-guide.js';
import { collectTargets, hasHaulableOutput, type TargetCandidates } from '../targets/index.js';
import type { PlannerContextSlot } from './context.js';
import { IdleStands } from './idle-replan.js';
import { ownersWithShelterRoom, standsThroughPass } from './replan.js';
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
  readonly siteSupply: SiteSupplyReach;
  readonly repairCrews: RepairCrews;
  readonly seatDoors: SeatDoors;
  readonly homeward: HomewardPosts;
  /** The buildings on alarm and the room each has left, empty on a map with no defence mode up, which
   *  is what makes the shelter rung free when nothing is happening. */
  readonly shelters: ShelterSites;
  /** {@link ownersWithShelterRoom} of {@link shelters} as the pass began. */
  readonly shelterRoom: ReadonlySet<number>;
  /** The adults whose ladder found them nothing to do this pass, so they stand. */
  readonly idle: IdleStands;
  /** Equipment errands that may still search for their store this pass; see
   *  {@link EQUIP_FETCH_SEARCHES_PER_PASS}. */
  readonly equipFetches: { remaining: number };
  readonly alert: PlanAlert;
  /** The one plan context the ladder hands its drives, made on the pass's first plan. */
  plan: PlannerContextSlot | undefined;
}

/** The battle alert of the settler being planned, memoized per plan; one function serves the pass. */
class PlanAlert {
  private entity: Entity | undefined;
  private answer: boolean | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly front: BattleFront,
  ) {}

  /** Whether {@link holdsGround} holds the settler of the last {@link PlanAlert.of} call. */
  private readonly ask = (): boolean => {
    if (this.answer === undefined && this.entity !== undefined) {
      this.answer = holdsGround(this.world, this.ctx, this.entity, this.front);
    }
    return this.answer === true;
  };

  /** The alert question for `e`'s plan, valid until the next call. */
  of(e: Entity): () => boolean {
    this.entity = e;
    this.answer = undefined;
    return this.ask;
  }
}

/**
 * Equipment errands whose store search one planner pass runs. An order handed to many settlers at once
 * (a player's mass equip, the assistant's grants on a fresh stock) would otherwise search from every
 * settler's node in one tick; the rest stand for a tick and search on the next pass, in id order.
 * Authored throttle, not the original's.
 */
export const EQUIP_FETCH_SEARCHES_PER_PASS = 8;

/** Snapshot the shared pass state at the top of a planner tick. */
export function beginPlannerPass(world: World, ctx: SystemContext, terrain: TerrainGraph): PlannerPass {
  const targets = collectTargets(world, ctx, terrain);
  const front = new BattleFront(world, ctx);
  const shelters = collectShelters(world, ctx);
  const shelterRoom = ownersWithShelterRoom(shelters);
  const seatDoors = new SeatDoors(world, ctx, terrain, targets.buildings);
  const supply = collectSupplyTally(world);
  const spacing = PlannerSpacing.forTick(world, ctx, terrain);
  return {
    world,
    ctx,
    terrain,
    targets,
    // Any one store answers, so the stores need no canonical order.
    anyHaulable: hasHaulableOutput(world, ctx, world.query(Stockpile, Position)),
    externalFood: new ExternalFoodIndex(world, ctx, terrain, supply),
    externalQuality: new ExternalQualityIndex(world, ctx, terrain, supply),
    spacing,
    farmClaims: collectFarmClaims(world),
    seatClaims: new WorkSeatClaims((e) => standsThroughPass(world, ctx, shelters, shelterRoom, e)),
    supply,
    harvestClaims: collectHarvestClaims(world),
    gossipCandidates: new GossipCandidates(world, ctx.content),
    front,
    constructionClaims: new ConstructionTaskClaims(world, ctx, supply),
    siteSupply: new SiteSupplyReach(world, ctx, terrain, spacing, targets),
    repairCrews: new RepairCrews(world, ctx, front),
    seatDoors,
    homeward: new HomewardPosts(world, terrain, seatDoors),
    shelters,
    shelterRoom,
    idle: new IdleStands(),
    equipFetches: { remaining: EQUIP_FETCH_SEARCHES_PER_PASS },
    alert: new PlanAlert(world, ctx, front),
    plan: undefined,
  };
}
