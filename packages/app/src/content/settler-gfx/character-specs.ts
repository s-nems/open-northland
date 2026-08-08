import {
  BUILD_GUIDE_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  HARVEST_CADAVER_ATOMIC,
  IRON_HARVEST_ATOMIC,
  KISS_ATOMIC,
  KISSED_ATOMIC,
  LISTEN_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
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
import { CIVILIST_JOB_HEADS, SCOUT_JOB_HEADS } from '../../catalog/roster.js';
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
 * names are matched verbatim - the source casing is mixed (`Warrior_Sword_Walk` vs `warrior_empty_walk`).
 */
export interface CharacterSpec {
  /** Key into the roster's `VIKING_CHARACTERS` for the body + default head stems. */
  readonly rosterId: string;
  /** Head look stems (without palette); defaults to the roster entry's full head list. */
  readonly headBmds?: readonly string[];
  /** The ×8 locomotion cycle; absent → the look stands its wait even while moving. */
  readonly walkSeq?: string;
  /**
   * The standing-idle `[bobseq]`, played whole as a facing-locked loop - no wait strip is a clean ×8 (the
   * generic waits 57/35/39, the weapon waits 22..29). Absent → idle holds the walk's first frame per facing.
   */
  readonly waitSeq?: string;
  /**
   * The viking `logicjob` this look hauls as - the `[gfxwalkatomic]` key for its per-good loaded gait.
   * Civilian trades all use the civilist table; the source authors no per-trade carry records. Absent → no
   * per-good carry look.
   */
  readonly logicJob?: number;
  /** Prefix of this body's per-good carry cycles (`<prefix><good>`) - the floor for an IR with no
   *  `[gfxwalkatomic]` lane, when the body has any. */
  readonly carryPrefix?: string;
  /** Atomic id → its action sequence on this body (the `setatomic` join, e.g. the woodcut swing). */
  readonly atomics?: Readonly<
    Record<number, { readonly seq: string; readonly phaseStart?: number; readonly ticksPerFrame?: number }>
  >;
  /**
   * Atomic id → the action sequence whose per-facing layout comes from the `[gfxanimatomic]` `<dir>` frame
   * lists, for a clip that is neither a clean ×8 strip nor a facing-locked one-off. A seq that resolves here
   * overrides the plain {@link atomics} fallback for the same id.
   */
  readonly dirListAtomics?: Readonly<
    Record<number, string | { readonly seq: string; readonly ticksPerFrame?: number }>
  >;
  /**
   * The attack swing bobseq name - the `[gfxanimatomic]` action-81 `gfxbobseqbody` for this look's viking
   * job. Its layout comes from the per-facing frame lists, so the name must be both a `[bobseq]` on this
   * body and a viking gfxAtomics record.
   */
  readonly attack?: string;
  /**
   * Px added to every body frame's draw `offsetY`, for a lib whose authored hotspots don't put the feet at
   * the anchor. Calibrated against the other bodies' feet line (sprite bottoms ~4..9 px below the anchor).
   */
  readonly feetShiftY?: number;
  /**
   * The combat-engaged gait bobseq names (`..._walk_agressive` / `..._wait_agressive`): a clean ×8 walk and
   * a facing-locked wait. Absent for a look with no aggressive variant, which stays on its relaxed gait.
   */
  readonly engaged?: { readonly moving?: string; readonly idle?: string };
}

/** Specs for every look, keyed by the id the job tables reference. `satisfies` keeps the keys literal, so
 *  a typo'd spec id in a job table is a compile error rather than a silent fall-to-default. */
export const CHARACTER_SPECS = {
  civilian: {
    rosterId: 'civilian',
    logicJob: JOB_CIVILIST,
    headBmds: CIVILIST_JOB_HEADS,
    walkSeq: 'human_man_generic_walk',
    waitSeq: 'human_man_generic_wait',
    carryPrefix: 'human_man_generic_walk_',
    // The civilist's fist brawl (job 6, the viking action-81 join) on the generic man body every civilian
    // trade shares.
    attack: 'human_man_Civilian_Fight_punch',
    // The atomics this body authors a sequence for. The pick-up bend serves both pickup and deposit - the
    // body authors no separate put-down, and a bound atomic wins over the carry override.
    atomics: {
      [HARVEST_ATOMIC]: { seq: CHOP_SEQ, phaseStart: CHOP_PHASE_START },
      [STONE_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ },
      [CLAY_HARVEST_ATOMIC]: { seq: SHOVEL_SEQ },
      [IRON_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ },
      [GOLD_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ },
      [MUSHROOM_HARVEST_ATOMIC]: { seq: PICKUP_SEQ },
      // Builder fallback (no gfx lists): the whole strip facing-locked, at the swing's half cadence.
      [BUILD_HOUSE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      // The body's one kiss clip serves both the kiss and kissed roles.
      [KISS_ATOMIC]: { seq: 'human_man_generic_kiss' },
      [KISSED_ATOMIC]: { seq: 'human_man_generic_kiss' },
      // The one speak clip serves talk and listen (the `[gfxanimatomic]` job-6 rows bind actions 14 and 15).
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
    // The collector and farmer work clips draw through the `[gfxanimatomic]` per-direction frame lists
    // (jobs 8 and 18). Each list bakes in one swing's impact hold and trailing rest (woodcutting 30/dir,
    // stonecrushing 29/dir, shovel 23/dir; the pluck is a single facing-locked 19-frame list).
    dirListAtomics: {
      [HARVEST_ATOMIC]: CHOP_SEQ,
      [STONE_HARVEST_ATOMIC]: STONECRUSH_SEQ,
      [CLAY_HARVEST_ATOMIC]: SHOVEL_SEQ,
      [IRON_HARVEST_ATOMIC]: STONECRUSH_SEQ,
      [GOLD_HARVEST_ATOMIC]: STONECRUSH_SEQ,
      [MUSHROOM_HARVEST_ATOMIC]: PICKUP_SEQ,
      [WHEAT_HARVEST_ATOMIC]: REAP_SEQ,
      [PLANT_ATOMIC]: SOW_SEQ,
      [CULTIVATE_ATOMIC]: WATER_SEQ,
      // The builder's hammer (action 39, 13 entries/dir) at half cadence.
      [BUILD_HOUSE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      // The kiss plays directionally (action-20/21 per-facing lists; the 60-frame strip is direction
      // blocks, not a clean ×8), so the groom faces his bride (TARGET_FACING).
      [KISS_ATOMIC]: 'human_man_generic_kiss',
      [KISSED_ATOMIC]: 'human_man_generic_kiss',
      // The chat plays the same way (action-14/15 lists, 247 entries/dir), so the talker faces its partner.
      [TALK_ATOMIC]: 'human_man_generic_speak',
      [LISTEN_ATOMIC]: 'human_man_generic_speak',
      // The meal and the nap carry their whole shape in the authored list, so neither may fall back to the
      // raw strip: the action-8 list is 237 entries (lie down, breathe where it lies, get up), action-10
      // is 30 (raise the food, chew, lower).
      [EAT_ATOMIC]: 'human_man_generic_eat',
      [SLEEP_ATOMIC]: 'human_man_generic_sleep',
    },
  },
  scout: {
    // The generic man body under the hatted scout heads (`jobgraphics.ini` logicjob 27 binds
    // `cr_hum_body_00` + heads 80..83). Its one trade action is the build-guide swing (action 43), which
    // the extracted gfxAtomics binds to the shared hammer clip.
    rosterId: 'civilian',
    headBmds: SCOUT_JOB_HEADS,
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
      // `jobtypes.ini`: the scout inherits the civilist atomic set, so it gossips on the same speak clip.
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
    dirListAtomics: {
      [BUILD_GUIDE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      [TALK_ATOMIC]: 'human_man_generic_speak',
      [LISTEN_ATOMIC]: 'human_man_generic_speak',
      [EAT_ATOMIC]: 'human_man_generic_eat',
      [SLEEP_ATOMIC]: 'human_man_generic_sleep',
    },
  },
  hunter: {
    // The generic man body under the civilist heads: the mod's `jobgraphics.ini` carries no `logicjob 15`
    // record, so the original falls to the civilist look too, with its own bow-in-hand clips.
    rosterId: 'civilian',
    headBmds: CIVILIST_JOB_HEADS,
    // Job 6 for the carry table: the job-15 walk lane authors only the unloaded (`logicgoodtype 0`)
    // gait, which the carry join drops - the loaded walks are the generic man's per-good cycles.
    logicJob: JOB_CIVILIST,
    walkSeq: 'human_man_hunter_walk',
    waitSeq: 'human_man_generic_wait', // the body authors no hunter wait
    carryPrefix: 'human_man_generic_walk_',
    attack: 'human_man_hunter_attack_bow',
    atomics: {
      [HARVEST_CADAVER_ATOMIC]: { seq: PICKUP_SEQ },
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
    dirListAtomics: {
      // The action-33 records all bind the generic bend-and-pick list.
      [HARVEST_CADAVER_ATOMIC]: PICKUP_SEQ,
      [TALK_ATOMIC]: 'human_man_generic_speak',
      [LISTEN_ATOMIC]: 'human_man_generic_speak',
      [EAT_ATOMIC]: 'human_man_generic_eat',
      [SLEEP_ATOMIC]: 'human_man_generic_sleep',
    },
  },
  woman: {
    rosterId: 'woman',
    logicJob: JOB_WOMAN,
    walkSeq: 'human_woman_generic_walk',
    waitSeq: 'human_woman_generic_wait',
    carryPrefix: 'human_woman_generic_walk_',
    // The woman's fist brawl (job 5 viking action-81) on her own body (cr_hum_body_10).
    attack: 'human_woman_Civilian_Fight_woman_punch',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_woman_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_woman_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_woman_generic_pray' },
      // The body's one kiss clip serves both the kiss and kissed roles.
      [KISS_ATOMIC]: { seq: 'human_woman_generic_kiss' },
      [KISSED_ATOMIC]: { seq: 'human_woman_generic_kiss' },
      // The one talk clip serves both roles (job-5 action-14/15 rows).
      [TALK_ATOMIC]: { seq: 'human_woman_generic_talk' },
      [LISTEN_ATOMIC]: { seq: 'human_woman_generic_talk' },
      [STORE_PICKUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
      [STORE_PILEUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
    },
    // The same per-facing list mechanism as the man's, at the job-5 rows.
    dirListAtomics: {
      [KISS_ATOMIC]: 'human_woman_generic_kiss',
      [KISSED_ATOMIC]: 'human_woman_generic_kiss',
      [TALK_ATOMIC]: 'human_woman_generic_talk',
      [LISTEN_ATOMIC]: 'human_woman_generic_talk',
      // Her nap has an authored 64-entry list (shorter than the 100-tick atomic, so she holds the
      // stance for the tail). No action-10 list exists for her body, so her meal keeps the strip.
      [SLEEP_ATOMIC]: 'human_woman_generic_sleep',
    },
  },
  boy: {
    rosterId: 'boy',
    logicJob: JOB_CHILD_MALE,
    walkSeq: 'human_child_boy_generic_walk',
    waitSeq: 'human_child_boy_generic_wait',
    // The child bodies author their own meal/nap clips, and the sim runs those drives for children too.
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_child_boy_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_child_boy_generic_sleep' },
    },
    // The child bodies author no action-10 list, so the meal keeps the plain strip.
    dirListAtomics: { [SLEEP_ATOMIC]: 'human_child_boy_generic_sleep' },
  },
  girl: {
    rosterId: 'girl',
    logicJob: JOB_CHILD_FEMALE,
    walkSeq: 'human_child_girl_generic_walk',
    waitSeq: 'human_child_girl_generic_wait_1',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_child_girl_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_child_girl_generic_sleep' },
    },
    dirListAtomics: { [SLEEP_ATOMIC]: 'human_child_girl_generic_sleep' },
  },
  baby: {
    rosterId: 'baby',
    logicJob: JOB_BABY_MALE,
    // The crawl (104 frames = a clean ×8 13-frame cycle) is the baby's locomotion.
    walkSeq: 'human_child_baby_generic_crouch',
    waitSeq: 'human_child_baby_generic_wait',
    // The baby lib's authored hotspots float its sprite bottom 4..10 px above the anchor (every other body
    // lands 4..9 px below); +14 re-seats it on the ground.
    feetShiftY: 14,
  },
  // The attack and aggressive-gait names are the viking (`logicdefines.inc` TRIBE_TYPE_HUMAN_VIKING = 1)
  // `[gfxanimatomic]` action-81 joins; the per-direction frame counts match the viking atomicanimation
  // lengths (spear 27, sword_long 29, bows 12/28). The unarmed body authors no `_agressive` gait.
  warrior: {
    rosterId: 'warrior',
    logicJob: JOB_SOLDIER_UNARMED,
    walkSeq: 'human_man_warrior_empty_walk',
    waitSeq: 'human_man_warrior_empty_wait',
    attack: 'human_man_warrior_empty_punch',
  },
  'warrior-spear': {
    rosterId: 'warrior',
    logicJob: JOB_SOLDIER_SPEAR_WOODEN,
    walkSeq: 'human_man_Warrior_spear_walk',
    waitSeq: 'human_man_Warrior_spear_wait',
    attack: 'human_man_Warrior_spear_attack',
    engaged: {
      moving: 'human_man_Warrior_spear_walk_agressive',
      idle: 'human_man_Warrior_spear_wait_agressive',
    },
  },
  'warrior-sword': {
    rosterId: 'warrior',
    logicJob: JOB_SOLDIER_SWORD,
    walkSeq: 'human_man_Warrior_Sword_Walk',
    waitSeq: 'human_man_Warrior_Sword_Wait',
    attack: 'human_man_Warrior_Sword_Attack_2',
    engaged: {
      moving: 'human_man_Warrior_Sword_Walk_agressive',
      idle: 'human_man_Warrior_Sword_Wait_agressive',
    },
  },
  'warrior-broadsword': {
    rosterId: 'warrior',
    logicJob: JOB_SOLDIER_BROADSWORD,
    walkSeq: 'human_man_Warrior_Broadsword_walk',
    waitSeq: 'human_man_Warrior_Broadsword_wait',
    attack: 'human_man_Warrior_Broadsword_attack',
    engaged: {
      moving: 'human_man_Warrior_Broadsword_walk_agressive',
      idle: 'human_man_Warrior_Broadsword_wait_agressive',
    },
  },
  'warrior-shortbow': {
    rosterId: 'warrior',
    logicJob: JOB_ARCHER,
    walkSeq: 'human_man_Warrior_Shortbow_walk',
    waitSeq: 'human_man_Warrior_Shortbow_wait',
    attack: 'human_man_Warrior_Shortbow_attack',
    engaged: {
      moving: 'human_man_Warrior_Shortbow_walk_agressive',
      idle: 'human_man_Warrior_Shortbow_wait_agressive',
    },
  },
  'warrior-longbow': {
    rosterId: 'warrior',
    logicJob: JOB_ARCHER_LONG,
    walkSeq: 'human_man_Warrior_Longbow_walk',
    waitSeq: 'human_man_Warrior_Longbow_wait',
    attack: 'human_man_Warrior_Longbow_attack',
    engaged: {
      moving: 'human_man_Warrior_Longbow_walk_agressive',
      idle: 'human_man_Warrior_Longbow_wait_agressive',
    },
  },
} satisfies Readonly<Record<string, CharacterSpec>>;

export type CharacterSpecId = keyof typeof CHARACTER_SPECS;

/** The specs as `[id, spec]` pairs widened to {@link CharacterSpec} - the per-entry literal value types
 *  differ, so iteration goes through this view. */
export const CHARACTER_SPEC_ENTRIES = Object.entries(CHARACTER_SPECS) as readonly (readonly [
  CharacterSpecId,
  CharacterSpec,
])[];

/**
 * Adult `jobType` → character spec id, the viking `[jobbasegraphics]` job → body join transcribed from the
 * mod's `types/humanstype/jobgraphics.ini` (`logictribe 1`) plus the `jobtypes` soldier family. The axe jobs
 * borrow the broadsword because the body authors no axe set, and the sabers the sword bodies. Named
 * approximation: heroes borrow the warrior body of their `baseatomics` soldier class until their own bodies
 * are extracted. An unmapped job falls to the `civilian` default.
 */
export const ADULT_CHARACTER_BY_JOB: Readonly<Record<number, CharacterSpecId>> = {
  [JOB_WOMAN]: 'woman',
  [JOB_SCOUT]: 'scout',
  [JOB_HUNTER]: 'hunter',
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
  [JOB_HERO_UNARMED]: 'warrior',
  [JOB_HERO_SPEAR]: 'warrior-spear',
  [JOB_HERO_SWORD]: 'warrior-sword',
  [JOB_HERO_SABER]: 'warrior-broadsword',
  [JOB_HERO_AXE]: 'warrior-broadsword',
  [JOB_HEROINE_BOW]: 'warrior-longbow',
};

/**
 * Equipped weapon good id-slug → warrior spec: the weapon in a settler's `Equipment.weapon` slot decides
 * the look regardless of its jobType, and a settler with no weapon good falls through to
 * {@link ADULT_CHARACTER_BY_JOB}. Keyed by slug (`goodtypes.ini` names, `sword_shord` typo verbatim)
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

/** The jobs a disarm strips to {@link UNARMED_WARRIOR_SPEC}: exactly the jobs the spawn seam can arm with
 *  a weapon good ({@link WEAPON_GOOD_SLUG_BY_JOB}). A job that can never re-arm keeps its body, so the axe
 *  soldiers (no axe good exists) never lose their drawn axe to an unrelated equip. */
export const WARRIOR_JOBS: readonly number[] = Object.keys(WEAPON_GOOD_SLUG_BY_JOB).map(Number);

/**
 * Age-class `jobType` (a settler that carries `Age`) → character spec id, the baby/child bodies from the
 * same `[jobbasegraphics]` table. Kept separate from the adult table so a synthetic fixture's adult job id
 * can never draw a baby.
 */
export const YOUNG_CHARACTER_BY_JOB: Readonly<Record<number, CharacterSpecId>> = {
  [JOB_BABY_FEMALE]: 'baby',
  [JOB_BABY_MALE]: 'baby',
  [JOB_CHILD_FEMALE]: 'girl',
  [JOB_CHILD_MALE]: 'boy',
};
