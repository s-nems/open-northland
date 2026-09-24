// Cross-package simulation surface used by app/render. Per-tick systems and implementation helpers
// stay package-private; scenes consume authored-setup constructors, read views, and shared constants.

// The AI opening plan's content bindings, exported so the real-content suite can pin every id against
// the served IR: an unknown id silently skips its entry in the sim.
export {
  BASE_REPLACEMENT_ENTRY,
  type BuildOrderEntry,
  DEFAULT_BUILD_ORDER,
  TOWER_CONTENT_IDS,
} from './ai-player/build-order/index.js';
// The scripted handlers' round, so a real-content probe can step to a seat's turn.
export { AI_HANDLER_ROUND_TICKS } from './ai-player/cadence.js';
// Exported so an acceptance scene can pin the garrison the AI seat walls in.
export { TOWER_GARRISON_ARCHERS } from './ai-player/military/index.js';
export {
  COLLECTOR_TARGET_BY_GOOD_ID,
  CRAFT_RESTRICTIONS_BY_BUILDING_ID,
  DEFAULT_COLLECTOR_TARGET,
  OPENING_HUNT_UNTIL_BUILDING_ID,
  STAFFING_BY_BUILDING_ID,
} from './ai-player/workforce/index.js';
export {
  CHEST_CONTENTS,
  type ChestReward,
  type ChestSpec,
  createChest,
  jobCanOpenChest,
  resolveChestReward,
} from './chests/index.js';
// The battle alert's rest clearance, so the details panel captions a unit standing to on the same radius
// the drive ladder holds it at.
export { REST_CLEARANCE_NODES } from './conflict/battle-alert.js';
export { BERRY_REGROW_TICKS, BERRY_STAGE_TICKS, createBerryBush } from './economy/berries.js';
export { createMapCrop } from './economy/fields.js';
export { addFishSwarms, FISH_REPRODUCTION_TICKS, MAX_FISH_PER_SWARM } from './economy/fish.js';
export { createGroundGoods, type GroundGoodsSpec } from './economy/ground-goods.js';
export { isOnMission } from './family/eligibility.js';
export {
  createResourceNode,
  resourceFootprintForGood,
  stampResourceFootprintOrFallback,
} from './footprint/resources.js';
export { ADULT_AGE_TICKS, CHILD_AGE_TICKS, isChild, TICKS_PER_AGE_YEAR } from './lifecycle/ageclass.js';
// The need levels the HUD marks its bars and bubbles against, so presentation cannot drift from the
// level the drives fire at.
export {
  NEED_CRITICAL_THRESHOLD,
  NEED_DRIVE_THRESHOLD,
  NEED_OVERFILL_FLOOR,
} from './lifecycle/needs/index.js';
// The herding ring bound, asserted by the livestock scene; the slaughter clip's wares, so the
// real-content suite reads them the way the sim does.
export { LIVESTOCK_GRAZE_RANGE_NODES } from './livestock/assignment.js';
export { slayDepositGoods } from './livestock/slay-clip.js';
// The match cadence, so an acceptance scene can run past the first verdict without restating it.
export { MATCH_DEATH_CHECK_INTERVAL_TICKS, MATCH_DEATH_GRACE_TICKS } from './match/index.js';
// The mission engine's cadence, the opcodes it runs, and the ids a world's placements carry: the
// coverage report and the real-content suite read these from outside the package.
export {
  MISSION_EVALUATION_TICKS,
  missionObjectIds,
  missionObjects,
  SUPPORTED_GOALS,
  SUPPORTED_RESULTS,
} from './missions/index.js';
// So the school dialog offers exactly the courses the `learn` command accepts.
export { knowsCourse } from './orders/education.js';
export {
  experienceBonus,
  experienceRepeats,
  fightDamageBonus,
  rawXpForRepeats,
  requirementRepeats,
  scoutVisionBonusNodes,
} from './progression/bonus.js';
export {
  FIGHT_EXPERIENCE_TYPE,
  SCOUT_EXPERIENCE_TYPE,
  SOLDIER_GENERAL_EXPERIENCE_TYPE,
  TRAINING_EXPERIENCE_TYPE,
} from './progression/experience.js';
// The atomic clip resolution and the need channels its events carry, so the real-content suite can pin the
// joins against the served IR rather than a fixture, and the committed catalog can author its cues and its
// need clips on the same ids the sim reads back.
export {
  ATOMIC_EVENT_CHANNEL,
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK,
  atomicClipName,
  atomicClipNameAtHome,
  atomicDuration,
  atomicDurationForName,
  atomicEventChannelDelta,
} from './readviews/animations.js';
export { HEADQUARTERS_BUILDING_ID, isBarracksType, isSchoolType } from './readviews/buildings.js';
export { EDIBLE_FORM_BY_DISH, edibleGoodFormOf } from './readviews/food.js';
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
  scoutJobType,
} from './readviews/jobs.js';
export { MILITARY_MODE } from './readviews/stances.js';
// Exported so the app's livestock-heart projection keys on the same content read as the capture drive,
// and so a real-content scenario stands its herd on the same pool the spawn would give it.
export { animalHitpoints, isCatchableAnimal } from './readviews/tribes/animals.js';
// The livestock join, so the details panel names a farm's herds from the same table the sim breeds by
// and the real-content suite can pin the slug join on the extracted ids.
export {
  isLivestockWorkplaceType,
  livestockGoodOfTribe,
  livestockTribeOfGood,
  slayAtomicOfSpecies,
} from './readviews/tribes/livestock.js';
// jobCanBuild is the "can this trade raise a foundation" gate, so the app's right-click on a site cannot
// drift from the rule assignBuilder and the builder drive ask; PRAY_ATOMIC_ID keys the app's pray gate.
export { jobCanBuild, PRAY_ATOMIC_ID } from './settlers/atomics/start.js';
// The idle re-plan period, so a real-content probe can wait out an idle settler's reaction to new work.
export { IDLE_REPLAN_PERIOD_TICKS } from './settlers/planner/idle-replan.js';
// createSignpost lets pre-tick assembly and a scene stand a post the way the erect does, links included.
export {
  canPlaceSignpost,
  createSignpost,
  type SignpostProbe,
  type SignpostSite,
  signpostNetwork,
  signpostProbe,
} from './signposts/index.js';
export { createSettler, DEFAULT_SETTLER_HITPOINTS } from './spawn/index.js';
export { isYardHeap, MAX_GROUND_STACK } from './stores/index.js';
export { cellOfNode } from './vision/gates.js';
export { SCOUT_VISION_NODES } from './vision/system.js';
