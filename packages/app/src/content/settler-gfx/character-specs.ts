import {
  BUILD_GUIDE_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  FISH_CAST_ATOMIC,
  FISH_CAUGHT_ATOMIC,
  FISH_FAILED_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  HARVEST_CADAVER_ATOMIC,
  IRON_HARVEST_ATOMIC,
  KISS_ATOMIC,
  KISSED_ATOMIC,
  LISTEN_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  OPEN_CHEST_ATOMIC,
  PLANT_ATOMIC,
  STONE_HARVEST_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  TALK_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BABY_FEMALE,
  JOB_BABY_MALE,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_FISHER,
  JOB_HERO_AXE,
  JOB_HERO_SABER,
  JOB_HERO_SPEAR,
  JOB_HERO_SWORD,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_HUNTER,
  JOB_SCOUT,
  JOB_SOLDIER_AXE_BIG,
  JOB_SOLDIER_AXE_SMALL,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SABER_LONG,
  JOB_SOLDIER_SABER_SHORT,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../../catalog/jobs.js';
import { WEAPON_GOOD_SLUG_BY_JOB } from '../../game/sandbox/ids/weapons.js';
import {
  CHOP_PHASE_START,
  CHOP_SEQ,
  EAT_ATOMIC,
  HAMMER_SEQ,
  HAMMER_TICKS_PER_FRAME,
  PICKUP_SEQ,
  PRAY_ATOMIC,
  REAP_SEQ,
  SHOVEL_SEQ,
  SLEEP_ATOMIC,
  SOW_SEQ,
  STONECRUSH_SEQ,
  WATER_SEQ,
} from './sequences.js';

/**
 * One settler look: the roster body/heads it composes and the body's `[bobseq]` names per state. Sequence
 * names are matched verbatim, and the source casing is mixed (`Warrior_Sword_Walk` vs `warrior_empty_walk`).
 */
export interface CharacterSpec {
  /**
   * The `[jobbasegraphics]` `logicjob`s whose record draws this look, best first: a tribe authors no
   * record for every soldier class, so the chain ends at the class this look degrades to. A tribe with
   * no record in the chain has no such look and its jobs draw the base tribe's.
   */
  readonly gfxJobs: readonly number[];
  /** The ×8 locomotion cycle; absent → the look stands its wait even while moving. */
  readonly walkSeq?: string;
  /** The standing-idle `[bobseq]`; absent → idle holds the walk's first frame per facing. */
  readonly waitSeq?: string;
  /**
   * The viking `logicjob` this look hauls as, the `[gfxwalkatomic]` key for its per-good loaded gait.
   * Civilian trades all use the civilist table, since the source authors no per-trade carry records.
   */
  readonly logicJob?: number;
  /** Prefix of this body's per-good carry cycles (`<prefix><good>`) - the floor for an IR with no
   *  `[gfxwalkatomic]` lane, when the body has any. */
  readonly carryPrefix?: string;
  /**
   * Atomic id → its action sequence on this body (the `setatomic` join). `phaseStart` tunes only the strip
   * fallback, `ticksPerFrame` applies to that and to the authored frame lists.
   */
  readonly atomics?: Readonly<
    Record<number, { readonly seq: string; readonly phaseStart?: number; readonly ticksPerFrame?: number }>
  >;
  /**
   * The attack swing bobseq name. Its layout comes from the per-facing frame lists, so the name must be
   * both a `[bobseq]` on this body and an action-81 `[gfxanimatomic]` record for this look's viking job.
   */
  readonly attack?: string;
  /**
   * Px added to every body frame's draw `offsetY`, for a lib whose authored hotspots don't put the feet at
   * the anchor. Calibrated against the other bodies' feet line.
   */
  readonly feetShiftY?: number;
  /**
   * The combat-engaged gait bobseq names (`..._walk_agressive` / `..._wait_agressive`). Absent for a look
   * with no aggressive variant, which stays on its relaxed gait.
   */
  readonly engaged?: { readonly moving?: string; readonly idle?: string };
}

/** Specs for every look, keyed by the id the job tables reference. `satisfies` keeps those keys literal, so
 *  a typo'd spec id in a job table is a compile error rather than a silent fall-to-default. */
export const CHARACTER_SPECS = {
  civilian: {
    gfxJobs: [JOB_CIVILIST],
    logicJob: JOB_CIVILIST,
    walkSeq: 'human_man_generic_walk',
    waitSeq: 'human_man_generic_wait',
    carryPrefix: 'human_man_generic_walk_',
    // The civilist's fist brawl (job 6) on the generic man body every civilian trade shares.
    attack: 'human_man_Civilian_Fight_punch',
    // The atomics this body authors a sequence for; their frame lists come from the collector/farmer jobs
    // 8 and 18 and the generic job-6 rows. The pick-up bend serves the deposit too, since the body authors
    // no separate put-down.
    atomics: {
      [HARVEST_ATOMIC]: { seq: CHOP_SEQ, phaseStart: CHOP_PHASE_START },
      [STONE_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ },
      [CLAY_HARVEST_ATOMIC]: { seq: SHOVEL_SEQ },
      [IRON_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ },
      [GOLD_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ },
      [MUSHROOM_HARVEST_ATOMIC]: { seq: PICKUP_SEQ },
      [WHEAT_HARVEST_ATOMIC]: { seq: REAP_SEQ },
      [PLANT_ATOMIC]: { seq: SOW_SEQ },
      [CULTIVATE_ATOMIC]: { seq: WATER_SEQ },
      [BUILD_HOUSE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      [KISS_ATOMIC]: { seq: 'human_man_generic_kiss' },
      [KISSED_ATOMIC]: { seq: 'human_man_generic_kiss' },
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [OPEN_CHEST_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
  },
  scout: {
    // The hatted scout record (viking `logicjob 27` binds `cr_hum_body_00` + heads 80..83); a tribe
    // authoring none falls to its civilist record, hat included, and its scouts read as civilians. Its one
    // trade action is the build-guide swing.
    gfxJobs: [JOB_SCOUT, JOB_CIVILIST],
    logicJob: JOB_CIVILIST,
    walkSeq: 'human_man_generic_walk',
    waitSeq: 'human_man_generic_wait',
    carryPrefix: 'human_man_generic_walk_',
    attack: 'human_man_Civilian_Fight_punch',
    atomics: {
      [BUILD_GUIDE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [OPEN_CHEST_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
  },
  hunter: {
    // No tribe authors a `logicjob 15` record, so the hunter draws the civilian look with its own
    // bow-in-hand clips.
    gfxJobs: [JOB_HUNTER, JOB_CIVILIST],
    // Job 6 for the carry table: the job-15 walk lane authors only the unloaded (`logicgoodtype 0`) gait,
    // which the carry join drops.
    logicJob: JOB_CIVILIST,
    walkSeq: 'human_man_hunter_walk',
    waitSeq: 'human_man_generic_wait', // the body authors no hunter wait
    carryPrefix: 'human_man_generic_walk_',
    attack: 'human_man_hunter_attack_bow',
    atomics: {
      // The action-33 records all bind the generic bend-and-pick list.
      [HARVEST_CADAVER_ATOMIC]: { seq: PICKUP_SEQ },
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [OPEN_CHEST_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
  },
  fisher: {
    // Fishing has no separate `[jobbasegraphics]` row: it uses the civilian man's body and the dedicated
    // 432-bob fishing strip. Actions 36/37/38 select the cast, caught and empty-result frame lists from it.
    gfxJobs: [JOB_FISHER, JOB_CIVILIST],
    logicJob: JOB_CIVILIST,
    walkSeq: 'human_man_generic_walk',
    waitSeq: 'human_man_generic_wait',
    carryPrefix: 'human_man_generic_walk_',
    attack: 'human_man_Civilian_Fight_punch',
    atomics: {
      [FISH_CAST_ATOMIC]: { seq: 'human_man_fisher_work_fishing' },
      [FISH_CAUGHT_ATOMIC]: { seq: 'human_man_fisher_work_fishing' },
      [FISH_FAILED_ATOMIC]: { seq: 'human_man_fisher_work_fishing' },
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [OPEN_CHEST_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
  },
  woman: {
    gfxJobs: [JOB_WOMAN],
    logicJob: JOB_WOMAN,
    walkSeq: 'human_woman_generic_walk',
    waitSeq: 'human_woman_generic_wait',
    carryPrefix: 'human_woman_generic_walk_',
    // The woman's fist brawl (job 5) on her own body, `cr_hum_body_10`.
    attack: 'human_woman_Civilian_Fight_woman_punch',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_woman_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_woman_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_woman_generic_pray' },
      [KISS_ATOMIC]: { seq: 'human_woman_generic_kiss' },
      [KISSED_ATOMIC]: { seq: 'human_woman_generic_kiss' },
      [TALK_ATOMIC]: { seq: 'human_woman_generic_talk' },
      [LISTEN_ATOMIC]: { seq: 'human_woman_generic_talk' },
      [STORE_PICKUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
      [OPEN_CHEST_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
      [STORE_PILEUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
    },
  },
  boy: {
    gfxJobs: [JOB_CHILD_MALE],
    logicJob: JOB_CHILD_MALE,
    walkSeq: 'human_child_boy_generic_walk',
    waitSeq: 'human_child_boy_generic_wait',
    // The child bodies author their own meal and nap clips; the source carries no action-10 (eat) frame
    // list for them, so the meal plays the plain strip.
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_child_boy_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_child_boy_generic_sleep' },
    },
  },
  girl: {
    gfxJobs: [JOB_CHILD_FEMALE],
    logicJob: JOB_CHILD_FEMALE,
    walkSeq: 'human_child_girl_generic_walk',
    waitSeq: 'human_child_girl_generic_wait_1',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_child_girl_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_child_girl_generic_sleep' },
    },
  },
  baby: {
    gfxJobs: [JOB_BABY_MALE],
    logicJob: JOB_BABY_MALE,
    // The crawl is the baby's locomotion; its authored walk lists cut the cycle short of the block.
    walkSeq: 'human_child_baby_generic_crouch',
    waitSeq: 'human_child_baby_generic_wait',
    // The baby lib's authored hotspots float its sprite bottom 4..10 px above the anchor (every other body
    // lands 4..9 px below); +14 re-seats it on the ground.
    feetShiftY: 14,
  },
  // The attack and aggressive-gait names below are the viking (`logicdefines.inc` TRIBE_TYPE_HUMAN_VIKING
  // = 1) joins; their per-direction frame counts match the viking atomicanimation lengths (spear 27,
  // sword_long 29, bows 12/28). The unarmed body authors no `_agressive` gait.
  warrior: {
    gfxJobs: [JOB_SOLDIER_UNARMED],
    logicJob: JOB_SOLDIER_UNARMED,
    walkSeq: 'human_man_warrior_empty_walk',
    waitSeq: 'human_man_warrior_empty_wait',
    attack: 'human_man_warrior_empty_punch',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_man_warrior_empty_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_warrior_empty_sleep' },
    },
  },
  'warrior-spear': {
    gfxJobs: [JOB_SOLDIER_SPEAR_WOODEN, JOB_SOLDIER_UNARMED],
    logicJob: JOB_SOLDIER_SPEAR_WOODEN,
    walkSeq: 'human_man_Warrior_spear_walk',
    waitSeq: 'human_man_Warrior_spear_wait',
    attack: 'human_man_Warrior_spear_attack',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_man_Warrior_spear_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_Warrior_spear_sleep' },
    },
    engaged: {
      moving: 'human_man_Warrior_spear_walk_agressive',
      idle: 'human_man_Warrior_spear_wait_agressive',
    },
  },
  'warrior-sword': {
    gfxJobs: [JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED],
    logicJob: JOB_SOLDIER_SWORD,
    walkSeq: 'human_man_Warrior_Sword_Walk',
    waitSeq: 'human_man_Warrior_Sword_Wait',
    attack: 'human_man_Warrior_Sword_Attack_2',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_man_Warrior_Sword_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_Warrior_Sword_Sleep' },
    },
    engaged: {
      moving: 'human_man_Warrior_Sword_Walk_agressive',
      idle: 'human_man_Warrior_Sword_Wait_agressive',
    },
  },
  'warrior-broadsword': {
    gfxJobs: [JOB_SOLDIER_BROADSWORD, JOB_SOLDIER_UNARMED],
    logicJob: JOB_SOLDIER_BROADSWORD,
    walkSeq: 'human_man_Warrior_Broadsword_walk',
    waitSeq: 'human_man_Warrior_Broadsword_wait',
    attack: 'human_man_Warrior_Broadsword_attack',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_man_Warrior_Broadsword_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_Warrior_Broadsword_sleep' },
    },
    engaged: {
      moving: 'human_man_Warrior_Broadsword_walk_agressive',
      idle: 'human_man_Warrior_Broadsword_wait_agressive',
    },
  },
  'warrior-shortbow': {
    gfxJobs: [JOB_ARCHER, JOB_SOLDIER_UNARMED],
    logicJob: JOB_ARCHER,
    walkSeq: 'human_man_Warrior_Shortbow_walk',
    waitSeq: 'human_man_Warrior_Shortbow_wait',
    attack: 'human_man_Warrior_Shortbow_attack',
    // The archer's meal and nap (job 40) bind the bare-hands body's clips, so the bow disappears while he
    // eats; the `Shortbow_eat/_sleep` strips are unreferenced by the source.
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_man_warrior_empty_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_warrior_empty_sleep' },
    },
    engaged: {
      moving: 'human_man_Warrior_Shortbow_walk_agressive',
      idle: 'human_man_Warrior_Shortbow_wait_agressive',
    },
  },
  'warrior-longbow': {
    gfxJobs: [JOB_ARCHER_LONG, JOB_SOLDIER_UNARMED],
    logicJob: JOB_ARCHER_LONG,
    walkSeq: 'human_man_Warrior_Longbow_walk',
    waitSeq: 'human_man_Warrior_Longbow_wait',
    attack: 'human_man_Warrior_Longbow_attack',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_man_Warrior_Longbow_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_Warrior_Longbow_sleep' },
    },
    engaged: {
      moving: 'human_man_Warrior_Longbow_walk_agressive',
      idle: 'human_man_Warrior_Longbow_wait_agressive',
    },
  },
  // Hero bodies carry their arms in the authored bob set. Their exact walk, wait and attack sequence
  // names come from this tribe's animation rows; the soldier entry is only a missing-body fallback.
  'hero-unarmed': {
    gfxJobs: [JOB_HERO_UNARMED, JOB_SOLDIER_UNARMED],
    logicJob: JOB_HERO_UNARMED,
  },
  'hero-spear': {
    gfxJobs: [JOB_HERO_SPEAR, JOB_SOLDIER_SPEAR, JOB_SOLDIER_UNARMED],
    logicJob: JOB_HERO_SPEAR,
  },
  'hero-sword': {
    gfxJobs: [JOB_HERO_SWORD, JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED],
    logicJob: JOB_HERO_SWORD,
  },
  'hero-saber': {
    gfxJobs: [JOB_HERO_SABER, JOB_SOLDIER_BROADSWORD, JOB_SOLDIER_UNARMED],
    logicJob: JOB_HERO_SABER,
  },
  'hero-axe': {
    gfxJobs: [JOB_HERO_AXE, JOB_SOLDIER_AXE_BIG, JOB_SOLDIER_UNARMED],
    logicJob: JOB_HERO_AXE,
  },
  'hero-bow': {
    gfxJobs: [JOB_HEROINE_BOW, JOB_ARCHER_LONG, JOB_SOLDIER_UNARMED],
    logicJob: JOB_HEROINE_BOW,
  },
} satisfies Readonly<Record<string, CharacterSpec>>;

export type CharacterSpecId = keyof typeof CHARACTER_SPECS;

/** The specs as `[id, spec]` pairs widened to the interface, since the per-entry literal value types
 *  differ. */
export const CHARACTER_SPEC_ENTRIES = Object.entries(CHARACTER_SPECS) as readonly (readonly [
  CharacterSpecId,
  CharacterSpec,
])[];

/**
 * Adult `jobType` → character spec id, the viking `[jobbasegraphics]` join transcribed from the mod's
 * `types/humanstype/jobgraphics.ini` (`logictribe 1`) plus the `jobtypes` soldier family. Soldier axe jobs
 * borrow the broadsword because the body authors no axe set; heroes resolve through their own
 * `(tribe, job)` graphics rows. An unmapped job falls to the `civilian` default.
 */
export const ADULT_CHARACTER_BY_JOB: Readonly<Record<number, CharacterSpecId>> = {
  [JOB_WOMAN]: 'woman',
  [JOB_SCOUT]: 'scout',
  [JOB_HUNTER]: 'hunter',
  [JOB_FISHER]: 'fisher',
  [JOB_SOLDIER_UNARMED]: 'warrior',
  [JOB_SOLDIER_SPEAR_WOODEN]: 'warrior-spear',
  [JOB_SOLDIER_SPEAR]: 'warrior-spear',
  [JOB_SOLDIER_SWORD]: 'warrior-sword',
  [JOB_SOLDIER_BROADSWORD]: 'warrior-broadsword',
  [JOB_SOLDIER_SABER_SHORT]: 'warrior-sword',
  [JOB_SOLDIER_SABER_LONG]: 'warrior-broadsword',
  [JOB_SOLDIER_AXE_SMALL]: 'warrior-broadsword',
  [JOB_SOLDIER_AXE_BIG]: 'warrior-broadsword',
  [JOB_ARCHER]: 'warrior-shortbow',
  [JOB_ARCHER_LONG]: 'warrior-longbow',
  [JOB_HERO_UNARMED]: 'hero-unarmed',
  [JOB_HERO_SPEAR]: 'hero-spear',
  [JOB_HERO_SWORD]: 'hero-sword',
  [JOB_HERO_SABER]: 'hero-saber',
  [JOB_HERO_AXE]: 'hero-axe',
  [JOB_HEROINE_BOW]: 'hero-bow',
};

/** Hero jobs whose authored body and arms are one permanent visual identity. */
export const HERO_JOBS: readonly number[] = [
  JOB_HERO_UNARMED,
  JOB_HERO_SPEAR,
  JOB_HERO_SWORD,
  JOB_HERO_SABER,
  JOB_HERO_AXE,
  JOB_HEROINE_BOW,
];

/**
 * Equipped weapon good id-slug → warrior spec: the weapon in a settler's `Equipment.weapon` slot decides
 * the look regardless of its jobType, and a settler with no weapon good falls through to
 * {@link ADULT_CHARACTER_BY_JOB}. Keyed by slug (`goodtypes.ini` names, the `sword_shord` typo verbatim)
 * because the numeric good ids differ per content set.
 */
export const WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG: Readonly<Record<string, CharacterSpecId>> = {
  bow_short: 'warrior-shortbow',
  bow_long: 'warrior-longbow',
  spear_wooden: 'warrior-spear',
  spear_iron: 'warrior-spear',
  sword_shord: 'warrior-sword',
  sword_long: 'warrior-broadsword', // the two-hander
};

/** The empty-hand warrior body - what a weapon-job draws once its `Equipment.weapon` slot empties. */
export const UNARMED_WARRIOR_SPEC: CharacterSpecId = 'warrior';

/** The jobs a disarm strips to {@link UNARMED_WARRIOR_SPEC}: the jobs the spawn seam can arm with a weapon
 *  good. A job that can never re-arm keeps its body, so the axe soldiers (no axe good exists) never lose
 *  their drawn axe to an unrelated equip. */
export const WARRIOR_JOBS: readonly number[] = Object.keys(WEAPON_GOOD_SLUG_BY_JOB)
  .map(Number)
  .filter((job) => !HERO_JOBS.includes(job));

/**
 * Age-class `jobType` (a settler that carries `Age`) → character spec id, the baby and child bodies from
 * the same `[jobbasegraphics]` table. Kept separate from the adult table so a synthetic fixture's adult job
 * id can never draw a baby.
 */
export const YOUNG_CHARACTER_BY_JOB: Readonly<Record<number, CharacterSpecId>> = {
  [JOB_BABY_FEMALE]: 'baby',
  [JOB_BABY_MALE]: 'baby',
  [JOB_CHILD_FEMALE]: 'girl',
  [JOB_CHILD_MALE]: 'boy',
};
