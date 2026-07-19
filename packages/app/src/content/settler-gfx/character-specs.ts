import {
  BUILD_GUIDE_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
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
import { JOB_BABY_FEMALE, JOB_BABY_MALE, JOB_CHILD_FEMALE, JOB_CHILD_MALE } from '../../catalog/jobs.js';
import { CIVILIST_JOB_HEADS, SCOUT_JOB_HEADS } from '../../catalog/roster.js';
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

// ─── per-job settler characters (the `[jobbasegraphics]` join) ─────────────────────────────────────

/**
 * One in-game settler look to build — which roster body/heads it composes and which of that body's
 * `[bobseq]` names animate each state. Transcribed per body from the decoded sequence lists (the names
 * differ per body: the man walks `human_man_generic_walk`, the unarmed soldier
 * `human_man_warrior_empty_walk`, each armed soldier its weapon's own `..._<Weapon>_walk`). Sequence
 * names are matched verbatim (the source casing is mixed — `Warrior_Sword_Walk` vs `warrior_empty_walk`).
 */
export interface CharacterSpec {
  /** Key into {@link import('../../catalog/roster.js').VIKING_CHARACTERS} for the body + default head stems. */
  readonly rosterId: string;
  /** Head look stems override (without palette); defaults to the roster entry's full head list. The
   *  civilian narrows to the civilist-job heads 00..03 (the roster also carries the scout/druid looks). */
  readonly headBmds?: readonly string[];
  /** The ×8 locomotion cycle; absent (the baby) → the character stands its wait even while moving. */
  readonly walkSeq?: string;
  /**
   * The standing-idle `[bobseq]`, played whole as a single-direction breathing loop — no wait strip is
   * a clean ×8 (the generic waits 57/35/39, the weapon waits 22..29), and the established `clipDirs`
   * rule reads a non-×8 strip as facing-locked, exactly how the original plays them (source basis
   * "Character animation gallery"), so an armed soldier breathes holding his weapon. Absent (or missing
   * from the IR), idle falls back to holding the walk's first frame per facing — a directional still, the
   * never-crash floor.
   */
  readonly waitSeq?: string;
  /**
   * The viking `logicjob` this look hauls as — the `[gfxwalkatomic]` join key that picks its loaded
   * gait per good. Civilian trades share the civilist table (6): the source authors no per-trade
   * carry records, and they all draw the same generic man body. Absent → no per-good carry look.
   */
  readonly logicJob?: number;
  /** Prefix of this body's per-good carry cycles (`<prefix><good>`) — the floor for an IR with no
   *  `[gfxwalkatomic]` lane, when the body has any. */
  readonly carryPrefix?: string;
  /** Atomic id → its action sequence on this body (the `setatomic` join, e.g. the woodcut swing). */
  readonly atomics?: Readonly<
    Record<number, { readonly seq: string; readonly phaseStart?: number; readonly ticksPerFrame?: number }>
  >;
  /**
   * Atomic id → the action sequence whose directional layout comes from the extracted `[gfxanimatomic]`
   * per-`<dir>` frame lists (the farmer's field clips) — for a clip that is neither a clean ×8 strip nor
   * a facing-locked one-off, the frame lists are the per-facing cut. {@link characterBinding} builds a
   * render `FrameListAnim` from the per-atomic lists table (`actionFrameLists`), exactly the attack
   * swing's mechanism generalized beyond action 81. A seq that resolves here overrides any plain
   * {@link atomics} fallback entry for the same id; missing data leaves the fallback in place. An
   * object entry adds a per-clip cadence override (the hammer's half-speed swing).
   */
  readonly dirListAtomics?: Readonly<
    Record<number, string | { readonly seq: string; readonly ticksPerFrame?: number }>
  >;
  /**
   * The combat attack swing bobseq name (the `[gfxanimatomic]` action-81 `gfxbobseqbody` for this look's
   * viking job), bound to {@link ATTACK_ATOMIC}. Unlike {@link atomics}, its directional layout comes
   * from the per-facing frame lists (a melee swing pool is not a clean ×8 strip), so
   * {@link characterBinding} builds a render `FrameListAnim` from the extracted gfxAtomics table keyed by
   * this name — the name must be both a `[bobseq]` on this body and a viking gfxAtomics record.
   */
  readonly attack?: string;
  /**
   * Committed anchor calibration: px added to every body frame's draw `offsetY` — for a lib whose
   * authored hotspots don't put the feet at the anchor. Measured against the other bodies' feet line
   * (their sprite bottoms land ~4..9 px below the anchor).
   */
  readonly feetShiftY?: number;
  /**
   * The combat-engaged gait bobseq names (`..._walk_agressive` / `..._wait_agressive`) — the readied
   * walk/stand a soldier plays while advancing on or squaring up to an enemy. Bound to
   * {@link import('@open-northland/render').SettlerStateBinding.engaged}; absent for looks with no aggressive
   * variant (the unarmed body, civilians). The walk is a clean ×8 cycle, the wait a facing-locked strip
   * (like the relaxed wait).
   */
  readonly engaged?: { readonly moving?: string; readonly idle?: string };
}

/** Specs for every in-game look, keyed by the id the job tables below reference. Declared with
 *  `satisfies` (not a widened `Record<string, …>`) so the keys stay literal and a typo'd spec id in a
 *  job table is a compile error, not a silent fall-to-default. */
export const CHARACTER_SPECS = {
  civilian: {
    rosterId: 'civilian',
    logicJob: 6,
    headBmds: CIVILIST_JOB_HEADS,
    walkSeq: 'human_man_generic_walk',
    waitSeq: 'human_man_generic_wait',
    carryPrefix: 'human_man_generic_walk_',
    // The civilist brawls with fists when it fights (job 6 — the viking action-81 join); the same
    // generic man body every civilian trade shares, so any civilian that runs an attack atomic punches.
    attack: 'human_man_Civilian_Fight_punch',
    // Every atomic the sim issues that this body authors a sequence for. The pick-up bend serves both
    // pickup and deposit (the body authors no separate put-down; the same stoop reads as either — and a
    // bound atomic wins over the carry override, so the depositor stoops as its load leaves).
    atomics: {
      // Each raw-good harvest plays that good's own authored work clip — the collector's per-good motion.
      [HARVEST_ATOMIC]: { seq: CHOP_SEQ, phaseStart: CHOP_PHASE_START }, // wood — the woodcut axe swing
      [STONE_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ }, // stone — the shared mining strike
      [CLAY_HARVEST_ATOMIC]: { seq: SHOVEL_SEQ }, // clay/mud — the clayworker's shovel dig (soft ground)
      [IRON_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ }, // iron — the shared mining strike (faithful job→clip map)
      [GOLD_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ }, // gold — the shared mining strike (faithful job→clip map)
      [MUSHROOM_HARVEST_ATOMIC]: { seq: PICKUP_SEQ }, // mushroom — a bend-and-pluck (observed)
      // Builder fallback (no gfx lists): the whole strip facing-locked, at the swing's half cadence.
      [BUILD_HOUSE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      // The wedding kiss — the body's one kiss clip serves both the kiss and kissed roles.
      [KISS_ATOMIC]: { seq: 'human_man_generic_kiss' },
      [KISSED_ATOMIC]: { seq: 'human_man_generic_kiss' },
      // The gossip chat — the body's one speak clip serves both the talk and listen roles (the
      // `[gfxanimatomic]` job-6 rows bind it to both actions 14 and 15).
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
    // The collector's harvest clips + the farmer's field clips draw through the extracted
    // `[gfxanimatomic]` per-direction frame lists (job 8 / job 18), overriding the plain `atomics`
    // fallbacks above whenever the IR carries them. The lists are the original's authored work cycle —
    // one swing per atomic with the impact hold and trailing idle pad baked into the repeated entries
    // (woodcutting 30/dir, stonecrushing 29/dir, shovel 23/dir; the pluck is a single facing-locked
    // 19-frame list) — so a chop reads as one strike with its pauses, not the raw strip looped, and the
    // swing faces the way the gatherer stands (source basis "Gathering work animations").
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
      // The builder's hammer (action 39, 13 entries/dir) at half cadence — see HAMMER_TICKS_PER_FRAME.
      [BUILD_HOUSE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      // The kiss plays directionally (the `[gfxanimatomic]` action-20/21 per-facing lists — the 60-frame
      // strip is direction blocks, not a clean ×8), so the groom faces his bride instead of cycling the
      // whole strip (the reported "spinning" kiss); the render faces him at her (TARGET_FACING).
      [KISS_ATOMIC]: 'human_man_generic_kiss',
      [KISSED_ATOMIC]: 'human_man_generic_kiss',
      // The chat plays directionally the same way (action-14/15 per-facing lists, 247 entries/dir), so
      // the talker faces its partner (TARGET_FACING) instead of cycling the whole strip.
      [TALK_ATOMIC]: 'human_man_generic_speak',
      [LISTEN_ATOMIC]: 'human_man_generic_speak',
    },
  },
  scout: {
    // The scout: the same generic man body, distinguished by the hatted scout heads (`jobgraphics.ini`
    // logicjob 27 binds `cr_hum_body_00` + heads 80..83). Its one trade action is the build-guide swing
    // (action 43) — the extracted gfxAtomics binds it to the shared hammer clip, per-direction lists
    // included, exactly like the builder's action 39.
    rosterId: 'civilian',
    headBmds: SCOUT_JOB_HEADS,
    logicJob: 6,
    walkSeq: 'human_man_generic_walk',
    waitSeq: 'human_man_generic_wait',
    carryPrefix: 'human_man_generic_walk_',
    attack: 'human_man_Civilian_Fight_punch',
    atomics: {
      [BUILD_GUIDE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      // The scout gossips like a civilian (jobtypes.ini: scout inherits the civilist atomic set,
      // nothing forbidden) — the same generic man body plays the same speak clip.
      [TALK_ATOMIC]: { seq: 'human_man_generic_speak' },
      [LISTEN_ATOMIC]: { seq: 'human_man_generic_speak' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
    dirListAtomics: {
      [BUILD_GUIDE_ATOMIC]: { seq: HAMMER_SEQ, ticksPerFrame: HAMMER_TICKS_PER_FRAME },
      [TALK_ATOMIC]: 'human_man_generic_speak',
      [LISTEN_ATOMIC]: 'human_man_generic_speak',
    },
  },
  woman: {
    rosterId: 'woman',
    logicJob: 5,
    walkSeq: 'human_woman_generic_walk',
    waitSeq: 'human_woman_generic_wait',
    carryPrefix: 'human_woman_generic_walk_',
    // The woman's fist brawl (job 5 viking action-81) on her own body (cr_hum_body_10).
    attack: 'human_woman_Civilian_Fight_woman_punch',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_woman_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_woman_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_woman_generic_pray' },
      // The wedding kiss — the body's one kiss clip serves both the kiss and kissed roles.
      [KISS_ATOMIC]: { seq: 'human_woman_generic_kiss' },
      [KISSED_ATOMIC]: { seq: 'human_woman_generic_kiss' },
      // The gossip chat — the woman body's one talk clip serves both roles (job-5 action-14/15 rows).
      [TALK_ATOMIC]: { seq: 'human_woman_generic_talk' },
      [LISTEN_ATOMIC]: { seq: 'human_woman_generic_talk' },
      [STORE_PICKUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
      [STORE_PILEUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
    },
    // The directional kiss and chat — the same per-facing list mechanism as the man's (job 5 rows), so
    // the bride/talker faces her partner rather than cycling the whole strip.
    dirListAtomics: {
      [KISS_ATOMIC]: 'human_woman_generic_kiss',
      [KISSED_ATOMIC]: 'human_woman_generic_kiss',
      [TALK_ATOMIC]: 'human_woman_generic_talk',
      [LISTEN_ATOMIC]: 'human_woman_generic_talk',
    },
  },
  boy: {
    rosterId: 'boy',
    logicJob: 4,
    walkSeq: 'human_child_boy_generic_walk',
    waitSeq: 'human_child_boy_generic_wait',
    // The child bodies author their own meal/nap clips (`[bobseq]` `human_child_*_generic_eat`/`_sleep`);
    // the sim runs the eat/sleep drives for children, so bind them or a feeding child holds its wait pose.
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_child_boy_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_child_boy_generic_sleep' },
    },
  },
  girl: {
    rosterId: 'girl',
    logicJob: 3,
    walkSeq: 'human_child_girl_generic_walk',
    waitSeq: 'human_child_girl_generic_wait_1',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_child_girl_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_child_girl_generic_sleep' },
    },
  },
  baby: {
    rosterId: 'baby',
    logicJob: 2,
    // The crawl (104 frames = a clean ×8 13-frame cycle) — the baby's locomotion, so a wandering
    // newborn crawls instead of gliding in its wait pose.
    walkSeq: 'human_child_baby_generic_crouch',
    waitSeq: 'human_child_baby_generic_wait',
    // The baby lib's authored hotspots float its sprite bottom 4..10 px ABOVE the anchor (every other
    // body lands 4..9 px below) — the reported "hovering baby". +14 re-seats it on the ground.
    feetShiftY: 14,
  },
  // Attack + aggressive-gait bindings are the viking (`logicdefines.inc` TRIBE_TYPE_HUMAN_VIKING = 1)
  // `[gfxanimatomic]` action-81 joins — transcribed, not guessed: short sword swings Sword_Attack_2,
  // long sword the Broadsword swing, the longbow the Longbow swing (the per-direction frame counts match
  // the viking atomicanimation lengths: spear 27, sword_long 29, bows 12/28). The unarmed body authors
  // no `_agressive` gait, so 'warrior' omits `engaged` (it uses its relaxed walk/wait when engaged).
  warrior: {
    rosterId: 'warrior',
    logicJob: 31,
    walkSeq: 'human_man_warrior_empty_walk',
    waitSeq: 'human_man_warrior_empty_wait',
    attack: 'human_man_warrior_empty_punch',
  },
  'warrior-spear': {
    rosterId: 'warrior',
    logicJob: 32,
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
    logicJob: 34,
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
    logicJob: 35,
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
    logicJob: 40,
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
    logicJob: 41,
    walkSeq: 'human_man_Warrior_Longbow_walk',
    waitSeq: 'human_man_Warrior_Longbow_wait',
    attack: 'human_man_Warrior_Longbow_attack',
    engaged: {
      moving: 'human_man_Warrior_Longbow_walk_agressive',
      idle: 'human_man_Warrior_Longbow_wait_agressive',
    },
  },
} satisfies Readonly<Record<string, CharacterSpec>>;

/** A key of {@link CHARACTER_SPECS} — the literal spec-id union the job tables are typed by. */
export type CharacterSpecId = keyof typeof CHARACTER_SPECS;

/** The specs as `[id, spec]` pairs, widened to the {@link CharacterSpec} interface — the literal value
 *  types differ per entry (that's what makes the ids literal), so iteration goes through this view. */
export const CHARACTER_SPEC_ENTRIES = Object.entries(CHARACTER_SPECS) as readonly (readonly [
  CharacterSpecId,
  CharacterSpec,
])[];

/**
 * Adult `jobType` → character spec id — the viking `[jobbasegraphics]` job → body join, transcribed
 * from the mod's `types/humanstype/jobgraphics.ini` (`logictribe 1`) + the real `jobtypes` soldier
 * family: woman 5 → the woman body; the soldier jobs 31..41 → the armoured `cr_hum_body_05`, each
 * weapon class animating its weapon's walk (the axe jobs 38/39 borrow the closest two-hander, the
 * broadsword — the body authors no axe set; the sabers 36/37 borrow the sword/broadsword one-handers).
 * The named heroes 42..47 borrow the warrior body of their `baseatomics` soldier class
 * (`jobtypes.ini`: 42→31, 43→33, 44→34, 45→35, 46→39, 47→41) until their own bodies
 * (`jobgraphics.ini` binds e.g. `CR_Hum_Body_60`/`_64` for jobs 44/45) are extracted —
 * docs/tickets/render/hero-character-bodies.md.
 * Every unmapped job (all civilian trades — they share the generic man body in the original) falls to
 * the `civilian` default.
 */
export const ADULT_CHARACTER_BY_JOB: Readonly<Record<number, CharacterSpecId>> = {
  5: 'woman', // woman
  27: 'scout', // scout — the generic man body under the hatted scout heads (80..83)
  31: 'warrior', // soldier_unarmed
  32: 'warrior-spear', // soldier_spear_wooden
  33: 'warrior-spear', // soldier_spear_iron
  34: 'warrior-sword', // soldier_sword_short
  35: 'warrior-broadsword', // soldier_sword_long
  36: 'warrior-sword', // soldier_saber_short
  37: 'warrior-broadsword', // soldier_saber_long
  38: 'warrior-broadsword', // soldier_axe_small (no authored axe set — closest two-hander)
  39: 'warrior-broadsword', // soldier_axe_big
  40: 'warrior-shortbow', // soldier_bow_short
  41: 'warrior-longbow', // soldier_bow_long
  42: 'warrior', // hero_unarmed (baseatomics 31)
  43: 'warrior-spear', // hero_spear_siegfried (baseatomics 33)
  44: 'warrior-sword', // hero_sword_bjarni (baseatomics 34)
  45: 'warrior-broadsword', // hero_saber_hatschi (baseatomics 35 — the two-hander class)
  46: 'warrior-broadsword', // hero_axe (baseatomics 39; no authored axe set — closest two-hander)
  47: 'warrior-longbow', // heroine_bow_xena (baseatomics 41)
};

/**
 * Equipped weapon good id-slug → warrior character spec — the "a warrior is one profession; the weapon
 * in hand decides the look" join. A settler carrying one of these in its `Equipment.weapon` slot draws
 * that weapon's warrior body regardless of its jobType; a bare warrior (no weapon good) falls through to
 * {@link ADULT_CHARACTER_BY_JOB} (the unarmed body for `soldier_unarmed`). Keyed by the good's id slug
 * (`goodtypes.ini` names, `sword_shord` typo verbatim) because the numeric ids differ per content —
 * sandbox carries the weapon goods at +100 (137–142), real content at 37–42; the sheet loader joins
 * slug → the running content's typeId (`sprite-sheet/characters.ts`).
 */
export const WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG: Readonly<Record<string, CharacterSpecId>> = {
  bow_short: 'warrior-shortbow',
  bow_long: 'warrior-longbow',
  spear_wooden: 'warrior-spear',
  spear_iron: 'warrior-spear',
  sword_shord: 'warrior-sword',
  sword_long: 'warrior-broadsword', // the two-hander
};

/**
 * Age-class `jobType` (1..4, a settler that carries `Age`) → character spec id — the baby/child bodies
 * from the same `[jobbasegraphics]` table. Keyed only for young settlers so a synthetic fixture's adult
 * job id 1/2 can never draw a baby (the [dc3ef54] collision, disambiguated by the `Age` component).
 */
export const YOUNG_CHARACTER_BY_JOB: Readonly<Record<number, CharacterSpecId>> = {
  [JOB_BABY_FEMALE]: 'baby',
  [JOB_BABY_MALE]: 'baby',
  [JOB_CHILD_FEMALE]: 'girl',
  [JOB_CHILD_MALE]: 'boy',
};
