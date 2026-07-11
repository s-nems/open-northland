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

/** Ticks an UNWATERED field takes per growth stage (a watered one grows twice as fast — the sim's
 *  `WATERED_GROWTH_PER_TICK`). 100 ticks × 5 stages ≈ a watchable full cycle in the scene. */
export const WHEAT_TICKS_PER_STAGE = 100;

/** Units a ripe field drops as its cut sheaf when reaped. */
export const WHEAT_YIELD_PER_FIELD = 1;

/** How far from the farm's anchor its farmers sow, in half-cell NODES (16 nodes ≈ 8 tiles). */
export const FARM_FIELD_RADIUS = 16;

/** Most fields one farm keeps sown at once. */
export const FARM_MAX_FIELDS = 8;
