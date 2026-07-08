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
export const MUSHROOM_HARVEST_ATOMIC = 32;
