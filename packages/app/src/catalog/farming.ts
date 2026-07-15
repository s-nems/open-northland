import type { GoodFarming } from '@open-northland/data';

/**
 * The farm's field-cultivation calibration — the one global source for the wheat sow→water→grow→reap
 * loop's numbers: every scene/content set that farms wheat builds its `farming` block from these
 * constants so the pace can't drift per scene.
 *
 * Source split (see the sim's `GoodFarming` schema): {@link WHEAT_GROWTH_STAGES} is DATA — the
 * `landscapetypes.ini` `wheat (growing)` lane's `maximumValency 5`, matching the field gfx's 5 growth
 * frames. Everything else is OBSERVED calibration, pending tuning against the original — the readable
 * data carries no growth timing, field radius, field count, or per-field yield (the closest readable
 * number is `humanjobexperiencetypes.ini` "farmer wheat" `baserepeatcounter 2`, semantics unpinned).
 */

/** Growth stages a sown field passes through before it is ripe (DATA: `maximumValency 5`). */
export const WHEAT_GROWTH_STAGES = 5;

/** Ticks a watered field takes per growth stage (an unwatered field does not grow at all — watering
 *  is the sim's growth gate). 500 ticks × 4 stage steps = 2000 ticks ≈ 100 s at 20 ticks/s from
 *  watering to ripe (observed pacing, against the original's slow field turnaround). */
export const WHEAT_TICKS_PER_STAGE = 500;

/** Units a ripe field drops as its cut sheaf when reaped. */
export const WHEAT_YIELD_PER_FIELD = 1;

/** How far from the farm's anchor its farmers sow, in half-cell nodes (16 nodes ≈ 8 tiles). */
export const FARM_FIELD_RADIUS = 16;

/** The crew-independent base of the farm's field cap — the live cap is `FARM_FIELDS_BASE +
 *  FARM_FIELDS_PER_FARMER × bound field-farmers`, so the plot grows sublinearly with the crew:
 *  1 farmer works 6 fields, a pair 10, the full 4-man staff 18 (user-directed calibration — a lone
 *  farmer needed more than 5, but a pair at 12 read as too many). */
export const FARM_FIELDS_BASE = 2;
/** The per-farmer slope of the field cap (see {@link FARM_FIELDS_BASE}). */
export const FARM_FIELDS_PER_FARMER = 4;

/** The clean-room field-farming `farming` block per farmed good, keyed by its stable string id — the ONE
 *  source both the sandbox goods builder (`game/sandbox/content/catalog/goods.ts`) and the real-content
 *  overlay (`content/real-content.ts` `mergeRealContent`) read, so wheat farms at the same pace on either
 *  content base. Real ir.json extracts wheat's plant/cultivate/harvest atomics and its `producedOnMap`
 *  flag but not this growth timing (no readable growth constants), so the overlay pins it here — the last
 *  piece the sim's field loop needs, once the pipeline has (correctly) declined to give the farm a recipe. */
export const FARMING_BALANCE_BY_ID: Readonly<Record<string, GoodFarming>> = {
  wheat: {
    stages: WHEAT_GROWTH_STAGES,
    ticksPerStage: WHEAT_TICKS_PER_STAGE,
    yieldPerField: WHEAT_YIELD_PER_FIELD,
    fieldRadius: FARM_FIELD_RADIUS,
    fieldsBase: FARM_FIELDS_BASE,
    fieldsPerFarmer: FARM_FIELDS_PER_FARMER,
  },
};
