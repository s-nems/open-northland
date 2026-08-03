import type { GoodFarming } from '@open-northland/data';

/**
 * The farm's field-cultivation calibration: the one global source for the wheat sow, water, grow and reap
 * loop, so its pace cannot drift per scene.
 *
 * Source split: {@link WHEAT_GROWTH_STAGES} comes from readable original data and the farmer's stroke
 * count from the extracted `jobExperience` track. The rest is calibration observed in the running
 * original, whose data carries no growth timing, field radius, or per-field yield.
 *
 * The observed target is about 10 grain per farmer per 10 minutes, on a plot standing at about 24 plants
 * whatever the crew size. The stroke count sets what a grain costs in labor and {@link FARM_MAX_FIELDS}
 * sets the plot, so the ladder bends at the bottom: a lone farmer cannot re-water 24 fields in a stage.
 */

/** Growth stages a sown field passes through before it is ripe (the `landscapetypes.ini` `wheat (growing)`
 *  lane's `maximumValency 5`, matching the field gfx's 5 growth frames). */
export const WHEAT_GROWTH_STAGES = 5;

/** Nominal ticks a watered field takes per growth stage (an unwatered field does not grow at all -
 *  watering is the sim's growth gate). 500 ticks × 4 stage steps = 2000 ticks ≈ 167 s at 12 ticks/s from
 *  watering to ripe (observed pacing, against the original's slow field turnaround). */
export const WHEAT_TICKS_PER_STAGE = 500;

/** How far a single field's stage length may sit either side of {@link WHEAT_TICKS_PER_STAGE}. At ±40%
 *  a plot the farmers plough in one pass still ripens a few plants at a time instead of all at once -
 *  the original's staggered field, approximated (its per-plant timing is not decoded). */
export const WHEAT_GROWTH_SPREAD_PERCENT = 40;

/** Units a ripe field drops as its cut sheaf when reaped. */
export const WHEAT_YIELD_PER_FIELD = 1;

/** Strokes a farmer plays per field action, transcribed from `humanjobexperiencetypes.ini` type 46
 *  "farmer wheat" `baserepeatcounter 2`. */
export const WHEAT_WORK_REPEATS = 2;

/** How far from the farm's anchor its farmers sow, in half-cell nodes (16 nodes ≈ 8 tiles). */
export const FARM_FIELD_RADIUS = 16;

/** Fields one farm keeps standing at once, whatever its crew size: observed at 24-25 growing plants,
 *  which did not grow when more farmers were assigned. A plot this size also staggers the harvest, since
 *  one farmer cannot re-water it inside a {@link WHEAT_TICKS_PER_STAGE} window. */
export const FARM_MAX_FIELDS = 24;

/** The `farming` block per farmed good, keyed by its stable string id, so wheat farms at the same pace on
 *  either content base. Real ir.json extracts wheat's atomics but not this growth timing. */
export const FARMING_BALANCE_BY_ID: Readonly<Record<string, GoodFarming>> = {
  wheat: {
    stages: WHEAT_GROWTH_STAGES,
    ticksPerStage: WHEAT_TICKS_PER_STAGE,
    growthSpreadPercent: WHEAT_GROWTH_SPREAD_PERCENT,
    yieldPerField: WHEAT_YIELD_PER_FIELD,
    fieldRadius: FARM_FIELD_RADIUS,
    maxFields: FARM_MAX_FIELDS,
  },
};
