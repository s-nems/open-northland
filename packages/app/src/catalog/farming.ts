/**
 * The farm's field-cultivation calibration — the ONE global source for the wheat sow→water→grow→reap
 * loop's numbers, the farming twin of `felling.ts`: every scene/content set that farms wheat builds its
 * `farming` block from THESE constants so the pace can't drift per scene.
 *
 * Source split (see the sim's `GoodFarming` schema): {@link WHEAT_GROWTH_STAGES} is DATA — the
 * `landscapetypes.ini` `wheat (growing)` lane's `maximumValency 5`, matching the field gfx's 5 growth
 * frames. Everything else is OBSERVED calibration, pending tuning against the original — the readable
 * data carries no growth timing, field radius, field count, or per-field yield (the closest readable
 * number is `humanjobexperiencetypes.ini` "farmer wheat" `baserepeatcounter 2`, semantics unpinned).
 */

/** Growth stages a sown field passes through before it is ripe (DATA: `maximumValency 5`). */
export const WHEAT_GROWTH_STAGES = 5;

/** Ticks a WATERED field takes per growth stage (an unwatered field does not grow at all — watering
 *  is the sim's growth gate). 500 ticks × 4 stage steps = 2000 ticks ≈ 100 s at 20 ticks/s from
 *  watering to ripe — OBSERVED pacing: the first calibration (100/stage, ~10 s to ripe) read as
 *  arcade-fast against the original's slow field turnaround ("nie za szybko względem oryginału?"). */
export const WHEAT_TICKS_PER_STAGE = 500;

/** Units a ripe field drops as its cut sheaf when reaped. */
export const WHEAT_YIELD_PER_FIELD = 1;

/** How far from the farm's anchor its farmers sow, in half-cell NODES (16 nodes ≈ 8 tiles). */
export const FARM_FIELD_RADIUS = 16;

/** Fields ONE farmer keeps sown at once — the farm's live cap is `× bound field-farmers` (1 farmer
 *  works 5 fields, a pair 10…), so the plot size scales with the crew (user-directed calibration). */
export const FARM_FIELDS_PER_FARMER = 5;
