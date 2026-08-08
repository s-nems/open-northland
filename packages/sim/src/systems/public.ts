// Cross-package simulation surface used by app/render. Per-tick systems and implementation helpers
// stay package-private; scenes consume authored-setup constructors, read views, and shared constants.

export { withinNodeRadius } from '../nav/node-circle.js';
// The AI opening plan's content bindings, exported so the real-content suite can pin every id against
// the served IR: an unknown id silently skips its entry in the sim.
export {
  BASE_REPLACEMENT_ENTRY,
  type BuildOrderEntry,
  DEFAULT_BUILD_ORDER,
  TOWER_CONTENT_IDS,
} from './ai-player/build-order/index.js';
// Exported so an acceptance scene can pin the garrison the AI seat walls in.
export { TOWER_GARRISON_ARCHERS } from './ai-player/military/index.js';
export {
  COLLECTOR_TARGET_BY_GOOD_ID,
  CRAFT_RESTRICTIONS_BY_BUILDING_ID,
  DEFAULT_COLLECTOR_TARGET,
  OPENING_HUNT_UNTIL_BUILDING_ID,
  STAFFING_BY_BUILDING_ID,
} from './ai-player/workforce/index.js';
export { BERRY_REGROW_TICKS, BERRY_STAGE_TICKS, createBerryBush } from './economy/berries.js';
export { isOnMission } from './family/eligibility.js';
export { createResourceNode, resourceFootprintForGood } from './footprint/resources.js';
export {
  ADULT_AGE_TICKS,
  CHILD_AGE_TICKS,
  isBaby,
  isChild,
  TICKS_PER_AGE_YEAR,
} from './lifecycle/ageclass.js';
export { EAT_HUNGER_RESTORE, SLEEP_FATIGUE_RESTORE } from './lifecycle/needs.js';
// The herding ring bound, asserted by the livestock scene.
export { LIVESTOCK_GRAZE_RANGE_NODES } from './livestock/assignment.js';
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
export { schoolingMet } from './progression/unlocks.js';
// The atomic clip resolution, exported so the real-content suite can pin the joins against the served IR
// rather than a fixture, and the sandbox catalog can author its cues on the same event type.
export {
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  atomicClipName,
  atomicDurationForName,
  needAtomicDuration,
} from './readviews/animations.js';
export { HEADQUARTERS_BUILDING_ID, isBarracksType } from './readviews/buildings.js';
export { EDIBLE_FORM_BY_DISH, edibleGoodFormOf } from './readviews/food.js';
// The content-derived job roles, so the profession picker and the action ring offer exactly what the
// matching commands accept.
export {
  hunterJobType,
  isCarrierJobRow,
  isFighterJob,
  isFighterJobRow,
  isHeroJob,
  isHunterJob,
  isScoutJob,
  isSoldierJob,
  scoutJobType,
} from './readviews/jobs.js';
export { MILITARY_MODE } from './readviews/stances.js';
// Exported so the app's livestock-heart projection keys on the same content read as the capture drive.
export { isCatchableAnimal } from './readviews/tribes/animals.js';
// The livestock join, so the details panel hides the same slaughter recipe the sim's recipe table drops
// and the real-content suite can pin the slug join on the extracted ids.
export {
  isLivestockWorkplaceType,
  livestockGoodOfTribe,
  livestockMeatGoodOf,
  livestockTribeOfGood,
} from './readviews/tribes/livestock.js';
// The "can this trade raise a foundation" gate, so the app's right-click on a site cannot drift from the
// rule assignBuilder and the builder drive ask.
export { jobCanBuild } from './settlers/atomics/start.js';
export {
  FATIGUE_BUBBLE_THRESHOLD,
  FATIGUE_SLEEP_THRESHOLD,
  HUNGER_BUBBLE_THRESHOLD,
  HUNGER_EAT_THRESHOLD,
} from './settlers/drives/needs.js';
export {
  canPlaceSignpost,
  type SignpostProbe,
  type SignpostSite,
  signpostNetwork,
  signpostProbe,
} from './signposts/index.js';
export { createSettler, DEFAULT_SETTLER_HITPOINTS } from './spawn/index.js';
export { isYardHeap, MAX_GROUND_STACK } from './stores/index.js';
export { cellOfNode } from './vision/gates.js';
export { SCOUT_VISION_NODES } from './vision/system.js';
