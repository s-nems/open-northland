// Cross-package simulation surface used by app/render. Per-tick systems and implementation helpers
// stay package-private; scenes consume authored-setup constructors, read views, and shared constants.

// The scripted handlers' round, so a real-content probe can step to a seat's turn.
export { AI_HANDLER_ROUND_TICKS } from './ai-shared/cadence.js';
export { TOWER_POST_STRENGTH } from './ai-shared/military/census.js';
// The scout chase's cap, asserted by the scout-village scene.
export { SCOUT_CHASERS_PER_SCOUT } from './ai-shared/military/defence/militia.js';
// The band the assistant's flag follow keeps a gatherer's flag in.
export { FOLLOW_FLAG_BAND } from './assistant/flag-follow.js';
export { ASSISTANT_DECISION_PERIOD_TICKS, TRAIN_DISPATCHES_PER_DECISION } from './assistant/index.js';
export {
  CHEST_CONTENTS,
  type ChestReward,
  type ChestSpec,
  createChest,
  jobCanOpenChest,
  resolveChestReward,
} from './chests/index.js';
// The AI opening plan's content bindings, exported so the real-content suite can pin every id against
// the served IR: an unknown id silently skips its entry in the sim.
export {
  BASE_REPLACEMENT_ENTRY,
  type BuildOrderEntry,
  DEFAULT_BUILD_ORDER,
  MAX_ACTIVE_CONSTRUCTION_SITES,
  TOWER_CONTENT_IDS,
} from './computer-player/build-order/index.js';
// The difficulty profiles, whose craft plans and trimmed build orders the real-content suite resolves too.
export { AI_PROFILES, profileBuildOrder } from './computer-player/difficulty.js';
// What a computer seat remembers of the other seats, for a debug view.
export {
  type IntelOwnerSummary,
  type SeatIntelSummary,
  summarizeIntel,
} from './computer-player/knowledge/intel/index.js';
// What the map's scripts mean for a seat - objectives and scripted attacks - for a debug view; the
// static part (`seatMapIntentOf`) reads only the scripts and the brief, so a snapshot view can call it.
export {
  type Objective,
  type SeatMapIntent,
  type SeatThreat,
  seatMapIntentOf,
  seatTerritoryOf,
  type Trigger,
  type TriggerCondition,
} from './computer-player/knowledge/map-intent/index.js';
// A seat's view of the map brief (the `MapBrief` component in a snapshot), for a debug view.
export {
  type AccessClass,
  type GoodAccess,
  type SeatBrief,
  type SeatNeighbour,
  seatBriefOf,
  type ZoneSums,
} from './computer-player/knowledge/seat-brief.js';
// The garrison an acceptance scene pins, and the outfit the real-content plan test resolves.
export { SOLDIER_OUTFIT_GOOD_IDS, TOWER_GARRISON_ARCHERS } from './computer-player/military/index.js';
// A seat's military operations (the marching wave, raids) as plain data, for a debug view.
export { type OperationView, seatOperationsOf } from './computer-player/military/operations/index.js';
export {
  LANDING_COOLDOWN_TICKS,
  LANDING_EDGE,
  LANDING_RETREAT_LOSS_PCT,
} from './computer-player/military/operations/landing.js';
export {
  RAID_BAND_MEN,
  RAID_DELAY_MAX_TICKS,
  RAID_DELAY_MIN_TICKS,
  RAID_SEAT_CHANCE_PCT,
} from './computer-player/military/operations/raid.js';
export { WAVE_GATHER_TICKS, waveBandAt } from './computer-player/military/plan.js';
// A seat's strategy (economy, military plan and posture) and the seat brief it was chosen from, and its
// army, strongest believed enemy and next forecast attack, for a debug view.
export {
  type MilitaryOrders,
  militaryOrdersOf,
  ordersFor,
  type SeatMilitaryView,
  type SeatStrategyView,
  seatMilitaryViewOf,
  sendsFlankRaids,
} from './computer-player/strategy/index.js';
export { DEFEND_RATIO, PLAN_TUNING } from './computer-player/strategy/military.js';
// The discoveries a seat earns ahead of time and the men pinned on them, for a debug view.
export type { ApprenticeView } from './computer-player/technology/apprentices.js';
export { LANDING_BIG_SHIPS } from './computer-player/workforce/craft.js';
export {
  COLLECTOR_TARGET_BY_GOOD_ID,
  COLLECTOR_WORKSHOP_BY_GOOD_ID,
  CRAFT_PLANS_BY_BUILDING_ID,
  CRAFT_PLANS_BY_JOINERY_ROLE,
  DEFAULT_COLLECTOR_TARGET,
  NATURAL_ARMS_CRAFT_PLANS,
  STAFFING_BY_BUILDING_ID,
  SUPPLY_CARRIER_GOODS_BY_BUILDING_ID,
  supplyLines,
} from './computer-player/workforce/index.js';
// The battle alert's rest clearance, so the details panel captions a unit standing to on the same radius
// the drive ladder holds it at.
// The balance figures the reference window's articles name.
export { REST_CLEARANCE_NODES, STAND_TO_RADIUS_NODES } from './conflict/battle-alert.js';
// The radii and ranges the reference window's figures draw.
export { ATTACK_RETURN_SLACK_NODES } from './conflict/chase.js';
export { CONTESTED_GROUND_RADIUS_NODES } from './conflict/contested-ground.js';
export {
  APPROACH_BAND_DEPTH,
  VEHICLE_DEFENCE_LEASH_POINTS,
  VEHICLE_SCAN_RADIUS_POINTS,
} from './conflict/engage-vehicle.js';
export {
  DEFEND_LEASH_NODES,
  DEFEND_RADIUS_NODES,
  IGNORE_LEASH_NODES,
} from './conflict/engagement.js';
export { FLEE_STEP_NODES } from './conflict/flee.js';
export { FLIGHT_REACH_NODES } from './conflict/fright.js';
export { ALARM_PEOPLE_RADIUS_NODES, ALARM_SOLDIER_RADIUS_NODES } from './conflict/hit-alarm.js';
export { HUNT_CHASE_SLACK_NODES } from './conflict/hunting/ground.js';
export { HUNT_PREY_SCORE_CEILING } from './conflict/hunting/index.js';
// The ground a defence-capable building covers, drawn when it is selected or placed.
export { SHELTER_SHOT_PERIOD_TICKS, shelterFireRadius } from './conflict/shelter-fire.js';
export { AIM_ROLL_SPAN, AIM_TRUE_BASE, SCATTER_RANGE_DIVISOR } from './conflict/shot-aim.js';
export {
  ANIMAL_ACQUIRE_RANGE_NODES,
  ANIMAL_AGGRO_RADIUS_NODES,
  SIGHT_RADIUS_NODES,
} from './conflict/targeting.js';
export { TOWER_RANGE_BONUS_NODES } from './conflict/tower-post.js';
export { HOUSE_DAMAGE_PER_WALL_VALENCY } from './conflict/weapons.js';
export { BERRY_REGROW_TICKS, BERRY_STAGE_TICKS, createBerryBush } from './economy/berries.js';
export { STEPS_PER_UNIT } from './economy/construction.js';
export { STRANDED_FIELD_RECLAIM_TICKS } from './economy/field-reclaim.js';
export { createMapCrop } from './economy/fields.js';
export {
  addFishSwarms,
  FISH_CAST_ATOMIC,
  FISH_CAUGHT_ATOMIC,
  FISH_FAILED_ATOMIC,
  FISH_REPRODUCTION_TICKS,
  FISH_SHORE_SEARCH_RADIUS,
  fishGoodOf,
  MAX_FISH_PER_SWARM,
  workplaceShoreSearchRadius,
} from './economy/fish.js';
// The gather gate, so the app's right-click on a resource names the same gatherers `setGatherGood` accepts.
export { heldGatherGood, jobGatherGoods, jobGathersGood } from './economy/gather-goods.js';
export { DROPS_AS_NEW_WEAR_DIVISOR } from './economy/goods-spill.js';
export { createGroundGoods, type GroundGoodsSpec } from './economy/ground-goods.js';
export {
  postCollectsAroundWorkplace,
  postTakesHaulFlag,
  WORKPLACE_COLLECT_RADIUS,
  worksFieldFromPost,
} from './economy/haul-flag.js';
export {
  experienceBonusTenths,
  OUTPUT_TENTHS_PER_UNIT,
  toolBonusTenths,
} from './economy/production/bonus-output.js';
export { BREEDING_PAIR } from './economy/production/cycles.js';
// The repair crew cap, so the app's right-click and site pick fall through where assignBuilder refuses.
export { HITPOINTS_PER_REPAIR_STEP, REPAIR_CREW_LIMIT, WALL_REPAIR_CREW_LIMIT } from './economy/repair.js';
export { insideBuildingReservedZone } from './economy/reserved-decor.js';
export { jobUsesWorkFlag } from './economy/work-flag.js';
export { HEALING_DRAUGHT_BELOW_PCT } from './equipment/draughts.js';
export { BARE_HANDS_WORK_FACTOR_PCT } from './equipment/effects.js';
export { CARRYING_WEAR_FACTOR } from './equipment/wear.js';
export { MAKE_LOVE_ATOMIC_ID } from './family/children/make-love.js';
export { isOnMission } from './family/eligibility.js';
export type { HouseKey } from './footprint/geometry.js';
export { footprintCellsOf } from './footprint/resource-footprint-cells.js';
export {
  createResourceNode,
  resourceFootprintForGood,
  stampResourceFootprintOrFallback,
} from './footprint/resources.js';
export {
  ADULT_AGE_TICKS,
  ageTicksAt,
  CHILD_AGE_TICKS,
  isChild,
  TICKS_PER_AGE_YEAR,
} from './lifecycle/ageclass.js';
// The need levels the HUD marks its bars and bubbles against, so presentation cannot drift from the
// level the drives fire at, the near-death line its warning reads, and the derivation of a stored bar.
export {
  isNearDeath,
  mutNeeds,
  NEED_CRITICAL_THRESHOLD,
  NEED_CRITICAL_UNITS,
  NEED_DRIVE_THRESHOLD,
  NEED_DRIVE_UNITS,
  NEED_OVERFILL_FLOOR,
  NEED_OVERFILL_UNITS,
  NEED_RESERVE_UNITS,
  NEED_SATED_UNITS,
  needLevel,
  needLevels,
} from './lifecycle/needs/index.js';
export { DRAIN_RISE } from './lifecycle/needs/levels.js';
export {
  NEAR_DEATH_PER_MILLE,
  NEED_INIT_SPREAD_UNITS,
  REGENERATION_HITPOINTS_PER_TICK,
  STARVATION_HITPOINTS_PER_TICK,
} from './lifecycle/needs/system.js';
export {
  blessedHitpointCeiling,
  TEMPLE_AURA_HITPOINTS,
  TEMPLE_AURA_PIETY_UNITS,
  TEMPLE_AURA_RANGE,
} from './lifecycle/temple-aura.js';
// The herding ring bound and the farm herd's leash, asserted by the livestock scenes; the slaughter
// clip's wares, so the real-content suite reads them the way the sim does.
export { FARM_HERD_LEASH_NODES, LIVESTOCK_GRAZE_RANGE_NODES } from './livestock/assignment.js';
export { LIVESTOCK_CAPTURE_RANGE } from './livestock/capture.js';
export { ANIMAL_ADULT_AGE_TICKS } from './livestock/growth.js';
export { BIRTH_PARENT_RANGE } from './livestock/herd.js';
export { SCATTER_RANGE } from './livestock/scatter.js';
export { slayDepositGoods, slayYield } from './livestock/slay-clip.js';
export { REBUILD_NEAR_POINTS } from './map-ai/rebuild.js';
// The match cadence, so an acceptance scene can run past the first verdict without restating it.
export {
  MATCH_DEATH_CHECK_INTERVAL_TICKS,
  MATCH_DEATH_GRACE_TICKS,
  MATCH_GOAL_CHECK_TICKS,
  type MatchGoalProgress,
} from './match/index.js';
export { PEACE_KEEP_OUT_RADIUS_NODES, PEACE_NOTICE_MINUTES } from './match/peace.js';
// The mission engine's cadence, the opcodes it runs, and the ids a world's placements carry: the
// coverage report and the real-content suite read these from outside the package.
export {
  MISSION_EVALUATION_TICKS,
  missionObjectIds,
  missionObjects,
  SUPPORTED_GOALS,
  SUPPORTED_RESULTS,
} from './missions/index.js';
export { LEADER_UPKEEP_PERIOD_TICKS } from './movement/herd-roster.js';
export {
  MIN_STEP_TICKS,
  ROUGHNESS_MAX_ON_MAPS,
  UNMODIFIED_STEP,
  walkStepTicks,
} from './movement/walk-cost.js';
// So the school dialog offers exactly the courses the `learn` command accepts.
export { knowsCourse, SCHOOL_LESSON_TICKS } from './orders/education.js';
export { EXPLORE_MAX_FAILED_LEGS } from './orders/explore.js';
export { MEAL_BREAK_RETRY_TICKS } from './orders/meal-break.js';
export { WORK_FLAG_SNAP_MAX_RADIUS } from './orders/work/selection.js';
export { GATE_ENEMY_NEAR_POINTS } from './palisades/gate-control.js';
export { createPalisade, GATE_MIN_HEALTH_PCT, GATE_SPAN_OFFSETS, palisadeType } from './palisades/index.js';
export {
  EXPERIENCE_MASTERY_POINTS,
  EXPERIENCE_XP_PER_POINT,
  experienceBonus,
  experiencePercent,
  experiencePoints,
  experienceRepeats,
  FIGHT_EXPERIENCE_DAMAGE_CAP_HITS,
  rawXpForRepeats,
  requirementRepeats,
  weaponClassHits,
  withFightExperience,
} from './progression/bonus.js';
export {
  buildStepsPerSwing,
  EXPERIENCE_PCT_PER_SAVED_STROKE,
  strokesPerUnit,
} from './progression/efficiency.js';
export {
  FIGHT_EXPERIENCE_TYPE,
  SOLDIER_GENERAL_EXPERIENCE_TYPE,
  startingExperience,
  TRAINING_EXPERIENCE_TYPE,
} from './progression/experience.js';
// The atomic clip resolution and the need channels its events carry, so the real-content suite can pin the
// joins against the served IR rather than a fixture, and the committed catalog can author its cues and its
// need clips on the same ids the sim reads back.
export {
  ATOMIC_EVENT_CHANNEL,
  ATOMIC_EVENT_TYPE_ATTACK,
  ATOMIC_EVENT_TYPE_PICKUP,
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK,
  ATOMIC_EVENT_TYPE_SPLIT_UP,
  ATOMIC_EVENT_TYPE_TRANSFORM,
  atomicClipName,
  atomicDuration,
  atomicDurationForName,
  atomicEventChannelDelta,
  resolvedAtomicLength,
} from './readviews/animations.js';
export {
  combatClassOfType,
  HEADQUARTERS_BUILDING_ID,
  isBarracksType,
  isSchoolType,
} from './readviews/buildings.js';
// The weapon and armour classes the data's `mainType` carries, which the HUD groups soldiers by.
export { ARMOR_MAIN_TYPE } from './readviews/classes/armor.js';
export { ARMOR_MATERIAL, WEAPON_MAIN_TYPE } from './readviews/combat.js';
export { heroMayChangeSlot } from './readviews/equip-pick.js';
export { EDIBLE_FORM_BY_DISH, edibleGoodFormOf, isFoodIn } from './readviews/food.js';
// The content-derived job roles, so the profession picker and the action ring offer exactly what the
// matching commands accept.
export {
  hunterJobType,
  isCarrierJobRow,
  isFighterJob,
  isFighterJobRow,
  isFisherJob,
  isHeroJob,
  isHeroJobRow,
  isHunterJob,
  isScoutJob,
  isSoldierJob,
  isTraderJob,
  jobChangesProduction,
  jobNeedsReligion,
  scoutJobType,
} from './readviews/jobs.js';
// The landscape a dead animal leaves, so a scene's terrain types the same record the sim lays.
export { firstLandscapeGfxOf, MEAT_LANDSCAPE_SLUG } from './readviews/landscape.js';
export { productionAtomic } from './readviews/production-atomic.js';
export { MILITARY_MODE } from './readviews/stances.js';
// Exported so the app's livestock-heart projection keys on the same content read as the capture drive,
// and so a real-content scenario stands its herd on the same pool the spawn would give it.
export { animalCannotBeAttacked, animalHitpoints, isCatchableAnimal } from './readviews/tribes/animals.js';
export { playableTribes } from './readviews/tribes/civilizations.js';
// The livestock join, so the details panel names a farm's herds from the same table the sim breeds by
// and the real-content suite can pin the slug join on the extracted ids.
export {
  isLivestockWorkplaceType,
  livestockGoodOfTribe,
  livestockTribeOfGood,
  slayAtomicOfSpecies,
} from './readviews/tribes/livestock.js';
export { awaitsDraughtAnimal, isShipVehicle, isSiegeVehicle } from './readviews/vehicles.js';
// The laid road count, which the road scene's acceptance reads.
export { roadNodeCount } from './roads/index.js';
// What a blow and a meal are worth, for the reference window's own arithmetic.
export {
  BACK_SIDE_HIT_PCT,
  BEHIND_HIT_PCT,
  HIT_DIRECTION_PCT,
} from './settlers/atomics/effects/combat/hit/damage.js';
export { KIN_ALARM_RADIUS_NODES } from './settlers/atomics/effects/combat/hit/reactions.js';
export { SPILL_MAX_RADIUS } from './settlers/atomics/effects/goods/piles.js';
export { AT_HOME_FACTOR, AWAY_REST_DIVISOR } from './settlers/atomics/effects/need-events.js';
// jobCanBuild is the "can this trade raise a foundation" gate, so the app's right-click on a site cannot
// drift from the rule assignBuilder and the builder drive ask; PRAY_ATOMIC_ID keys the app's pray gate.
export {
  BUILD_HOUSE_ATOMIC_ID,
  EAT_ATOMIC_ID,
  EAT_CANDY_ATOMIC_ID,
  EXERCISE_ATOMIC_ID,
  jobCanBuild,
  PICKUP_ATOMIC_ID,
  PRAY_ATOMIC_ID,
  SLEEP_ATOMIC_ID,
} from './settlers/atomics/start.js';
export { STROKE_REST_ATOMIC_IDS } from './settlers/atomics/stroke-cadence.js';
export { CART_TOP_UP_REACH } from './settlers/drives/economy/cart-top-up.js';
export { REPAIR_CALM_TICKS } from './settlers/drives/economy/repair.js';
export { VEHICLE_CARGO_SEARCH_RADIUS } from './settlers/drives/economy/vehicle-cargo.js';
export { BARRACKS_DRILL_TICKS } from './settlers/drives/training.js';
// Whom the assistant hands a tool: the trades that work with one.
export { toolHelpsJob } from './settlers/planner/assistant-grants.js';
// The idle re-plan period, so a real-content probe can wait out an idle settler's reaction to new work.
export { IDLE_REPLAN_PERIOD_TICKS } from './settlers/planner/idle-replan.js';
export { BUSH_AT_HAND_NODES } from './settlers/targets/food.js';
export { UNREACHABLE_GOAL_MEMO_TICKS } from './settlers/unreachable-goals.js';
// createSignpost lets pre-tick assembly and a scene stand a post the way the erect does, links included.
export {
  canPlaceSignpost,
  createSignpost,
  type SignpostProbe,
  type SignpostSite,
  signpostNetwork,
  signpostProbe,
} from './signposts/index.js';
export { createSettler, HUMAN_HITPOINTS, spawnAnimalHerd } from './spawn/index.js';
export { buildingRowKeepsPriority, isYardHeap, MAX_GROUND_STACK } from './stores/index.js';
export { canPinTradeShip, type TraderShipState } from './trade/index.js';
export { AI_STOCK_REFILL_LEVEL, AI_STOCK_REFILL_TURNS } from './trade/partner-stock.js';
export {
  cartDragTicks,
  DRAWN_CART_FULL_SPEED_LOSS_PERCENT,
  DRAWN_CART_LIFT_PERCENT,
  HANDCART_FULL_SPEED_LOSS_PERCENT,
  HANDCART_LIFT_PERCENT,
  loadSpeedLossPercent,
} from './vehicles/drag.js';
// createVehicle stands a vehicle in pre-tick assembly the way the command does; modifyVehicleStock and
// stockVehicleGoods are the writes into a hold, the second the booked-and-stowed one a loaded spawn uses.
export {
  createVehicle,
  modifyVehicleStock,
  removeVehicle,
  snapVehicleTarget,
  stockVehicleGoods,
  type VehicleStockView,
  type VehicleView,
  vehicleMovePeriod,
  vehicleStockGood,
} from './vehicles/index.js';
export { VEHICLE_CARGO_SPILL_RADIUS } from './vehicles/remove.js';
export { cellOfNode } from './vision/gates.js';
export {
  BUILDING_VISION_NODES,
  CART_VISION_NODES,
  CHILD_VISION_NODES,
  CIVILIAN_VISION_NODES,
  HEADQUARTERS_VISION_NODES,
  HERO_VISION_NODES,
  SCOUT_VISION_NODES,
  SHIP_VISION_NODES,
  SIEGE_VISION_NODES,
  SOLDIER_VISION_NODES,
} from './vision/system.js';
export { BREEDING_SPAN_TICKS, BREEDING_SPANS_PER_ROUND } from './wildlife/index.js';
