/**
 * The committed catalog of harvest ATOMIC ids — the original's `atomicForHarvesting` for each raw
 * good, transcribed from the extracted data (the collector job runs ONE per good). These are the
 * semantic action ids the SIM issues and the render/audio layers bind clips/SFX to, so they live in
 * `catalog/` where both the game content (`game/sandbox/`) and the binding reducers
 * (`content/settler-gfx.ts`) can read them without either owning the other's vocabulary.
 *
 * Each id binds to that good's OWN authored work clip (stone/iron/gold → the shared mining strike,
 * clay → shovel-dig, mushroom → pluck), not the shared woodcut swing — so a clay-digger visibly
 * SHOVELS and a stone miner STRIKES, neither chops (source basis; see `content/settler-gfx.ts`).
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

/** The farmer's SOWING action (`goodtypes.ini` wheat `atomicForPlanting 34`; `setatomic 18 34
 *  "viking_farmer_plant"`). */
export const PLANT_ATOMIC = 34;
/** The farmer's WATERING action (`goodtypes.ini` wheat `atomicForCultivating 35`; `setatomic 18 35
 *  "viking_farmer_cultivate"` — the watering-can clip). */
export const CULTIVATE_ATOMIC = 35;

/**
 * The combat attack swing (`setatomic <job> 81 "..._attack"`; the sim's `ATTACK_ATOMIC_ID`,
 * `packages/sim/src/systems/conflict/weapons.ts`). Shared vocabulary like the harvest ids: the settler
 * binding uses it as a `byAtomic` key, and the sheet loader filters the `[gfxanimatomic]` table for this
 * action — so it lives here, owned by neither. Its animation is the directional `FrameListAnim` layout,
 * not a bobseq range (a melee pool is not `length / 8`); see `content/settler-gfx.ts`.
 */
export const ATTACK_ATOMIC = 81;

/**
 * The build-house swing (`setatomic <job> 39 "..._builder_build_house"`; the sim's `BUILD_HOUSE_ATOMIC_ID`,
 * `packages/sim/src/systems/agents/actions.ts`). Shared vocabulary like the harvest ids: the render binds it
 * to the builder's hammer clip (`byAtomic`) and the audio binds it to the hammer SFX per swing — so it lives
 * here, owned by neither. Transcribed from `tribetypes.ini` (`setatomic 7 39`); the viking swing animation
 * (`viking_builder_build_house`) is 15 frames long (`atomicanimations.ini`, extracted).
 */
export const BUILD_HOUSE_ATOMIC = 39;
