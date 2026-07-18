/**
 * The committed catalog of atomic action ids, transcribed from the extracted data — the harvest ids are the
 * original's `atomicForHarvesting` per raw good (the collector job runs one per good). These are the semantic
 * ids the sim issues and the render/audio layers bind clips/SFX to, so they live in `catalog/` where the game
 * content (`game/sandbox/`) and the binding reducers (`content/settler-gfx.ts`) can both read them without
 * either owning the other's vocabulary. Each harvest id binds to that good's own authored work clip
 * (stone/iron/gold → the shared mining strike, clay → shovel-dig, mushroom → pluck), not the shared woodcut
 * swing (source basis; see `content/settler-gfx.ts`).
 */

/** The chop atomic id (the original's `harvest`) — wood's harvest action. */
export const HARVEST_ATOMIC = 24;
export const STONE_HARVEST_ATOMIC = 25;
export const CLAY_HARVEST_ATOMIC = 26;
export const IRON_HARVEST_ATOMIC = 27;
export const GOLD_HARVEST_ATOMIC = 28;
/** Wheat's scythe/reap action (`goodtypes.ini` wheat `atomicForHarvesting 29`). */
export const WHEAT_HARVEST_ATOMIC = 29;
export const MUSHROOM_HARVEST_ATOMIC = 32;

/** The farmer's sowing action (`goodtypes.ini` wheat `atomicForPlanting 34`; `setatomic 18 34
 *  "viking_farmer_plant"`). */
export const PLANT_ATOMIC = 34;
/** The farmer's watering action (`goodtypes.ini` wheat `atomicForCultivating 35`; `setatomic 18 35
 *  "viking_farmer_cultivate"` — the watering-can clip). */
export const CULTIVATE_ATOMIC = 35;

/**
 * The store-exchange pair every trade shares (`tribetypes.ini setatomic <job> 22/23
 * "viking_<class>_pickup"/"_pileup"`; the sim's `PICKUP/PILEUP_ATOMIC_ID`,
 * `packages/sim/src/systems/agents/actions.ts`): lift a load (22) and pile it into a store (23).
 */
export const STORE_PICKUP_ATOMIC = 22;
export const STORE_PILEUP_ATOMIC = 23;

/**
 * The combat attack swing (`setatomic <job> 81 "..._attack"`; the sim's `ATTACK_ATOMIC_ID`,
 * `packages/sim/src/systems/conflict/weapons.ts`). Its animation is the directional `FrameListAnim` layout,
 * not a bobseq range (a melee pool is not `length / 8`); see `content/settler-gfx.ts`.
 */
export const ATTACK_ATOMIC = 81;

/**
 * The build-house swing (`tribetypes.ini setatomic 7 39 "viking_builder_build_house"`; the sim's
 * `BUILD_HOUSE_ATOMIC_ID`, `packages/sim/src/systems/agents/actions.ts`). Its swing animation is 15 frames
 * long (`atomicanimations.ini`, extracted).
 */
export const BUILD_HOUSE_ATOMIC = 39;

/**
 * The wedding pair (`logicdefines.inc` KISS 20 / KISSED 21, sim `systems/family/weddings.ts`). Each body
 * authors one kiss clip (`human_*_generic_kiss`), so both roles bind the same sequence.
 */
export const KISS_ATOMIC = 20;
export const KISSED_ATOMIC = 21;

/**
 * The gossip pair (`logicdefines.inc` TALK 14 / LISTEN 15, sim `systems/social/gossip.ts`). The man body
 * authors one speak clip (`human_man_generic_speak` — the extracted `[gfxanimatomic]` binds it to both
 * actions 14 and 15), the woman body one talk clip (`human_woman_generic_talk`), so on each body both
 * roles bind the same sequence.
 */
export const TALK_ATOMIC = 14;
export const LISTEN_ATOMIC = 15;

/**
 * The scout's signpost-erecting swing (`jobtypes.ini` scout `allowatomic 43`; `logicdefines.inc`
 * `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_BUILD_GUIDE 43`). The extracted `gfxAtomics` binds tribe 1 / job 27 /
 * action 43 to the shared hammer clip, so the render times it like the builder's swing.
 */
export const BUILD_GUIDE_ATOMIC = 43;
