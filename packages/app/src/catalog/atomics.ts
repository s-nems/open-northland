/**
 * The committed catalog of atomic action ids, transcribed from the extracted data. The harvest ids are
 * the original's `atomicForHarvesting` per raw good, so each binds that good's own work clip rather than
 * one shared swing.
 */

/** Wood's harvest action (the original's `harvest`). */
export const HARVEST_ATOMIC = 24;
export const STONE_HARVEST_ATOMIC = 25;
export const CLAY_HARVEST_ATOMIC = 26;
export const IRON_HARVEST_ATOMIC = 27;
export const GOLD_HARVEST_ATOMIC = 28;
/** Wheat's scythe/reap action (`goodtypes.ini` wheat `atomicForHarvesting 29`). */
export const WHEAT_HARVEST_ATOMIC = 29;
export const MUSHROOM_HARVEST_ATOMIC = 32;
/** The hunter's carcass-harvest action (`goodtypes.ini` leather/meat `atomicForHarvesting 33`). */
export const HARVEST_CADAVER_ATOMIC = 33;

/** The farmer's sowing action (`goodtypes.ini` wheat `atomicForPlanting 34`). */
export const PLANT_ATOMIC = 34;
/** The farmer's watering action (`goodtypes.ini` wheat `atomicForCultivating 35`). */
export const CULTIVATE_ATOMIC = 35;

/** The fisher's cast, caught-fish, and failed-cast sequence. */
export const FISH_CAST_ATOMIC = 36;
export const FISH_CAUGHT_ATOMIC = 37;
export const FISH_FAILED_ATOMIC = 38;

/**
 * The store-exchange pair every trade shares (`tribetypes.ini setatomic <job> 22/23`): lift a load (22)
 * and pile it into a store (23).
 */
export const STORE_PICKUP_ATOMIC = 22;
export const STORE_PILEUP_ATOMIC = 23;

/** Drawing water from a well and honey from a hive. The original selects these actions from the
 *  utility's building type: the well pumps, while the hive reuses the generic pick-up bend. */
export const WELL_DRAW_ATOMIC = 44;
export const HIVE_DRAW_ATOMIC = 45;

/**
 * The combat attack swing (`setatomic <job> 81 "..._attack"`). Its animation is the directional
 * `FrameListAnim` layout, not a bobseq range, so a melee pool is not `length / 8`.
 */
export const ATTACK_ATOMIC = 81;

/**
 * The build-house swing (`tribetypes.ini setatomic 7 39 "viking_builder_build_house"`), whose animation
 * is 15 frames long (`atomicanimations.ini`, extracted).
 */
export const BUILD_HOUSE_ATOMIC = 39;

/**
 * The need slots (`logicdefines.inc` SLEEP 8 / EAT_SLOT_FOOD 10 / PRAY 12), bound per body class by
 * `tribetypes.ini setatomic <job> 8/10/12`. Their clips carry what a rest, a meal and a prayer are worth.
 */
export const SLEEP_ATOMIC = 8;
export const EAT_ATOMIC = 10;
export const PRAY_ATOMIC = 12;

/**
 * The wedding pair (`logicdefines.inc` KISS 20 / KISSED 21). Each body authors one kiss clip, so both
 * roles bind the same sequence.
 */
export const KISS_ATOMIC = 20;
export const KISSED_ATOMIC = 21;

/**
 * The gossip pair (`logicdefines.inc` TALK 14 / LISTEN 15). Each body authors one speak clip that the
 * extracted `[gfxanimatomic]` binds to both actions, so both roles bind the same sequence.
 */
export const TALK_ATOMIC = 14;
export const LISTEN_ATOMIC = 15;

/**
 * The scout's signpost-erecting swing (`jobtypes.ini` scout `allowatomic 43`). The extracted `gfxAtomics`
 * binds it to the shared hammer clip, so the render times it like the builder's swing.
 */
export const BUILD_GUIDE_ATOMIC = 43;

/** One drill repetition at the barracks (`logicdefines.inc` EXERCISE 89). */
export const EXERCISE_ATOMIC = 89;

/** The bend over a chest's lid (`logicdefines.inc` OPEN_CHEST 91); the mod's `animations.ini` binds it to
 *  the generic pick-up clip, which the characters reuse here. */
export const OPEN_CHEST_ATOMIC = 91;
