import type { GoodFarming } from '@open-northland/data';

/**
 * The farm's field-cultivation calibration: the one global source for the wheat sow, water and reap loop,
 * so its pace cannot drift per scene. The vocabulary, the stage count and the yield are readable original
 * data and the plot size is observed against the running original; the radius, the plant packing and the
 * stroke gate are approximations. The observed target is about 10 grain per farmer per 10 minutes, which
 * an idealized farm without hunger or sleep runs well above.
 */

/** Growth stages a sown field passes through before it is ripe, one per watering (the `landscapetypes.ini`
 *  `wheat (growing)` lane's `maximumValency 5`, matching the field gfx's 5 growth frames). */
export const WHEAT_GROWTH_STAGES = 5;

/** Units a ripe field drops as its cut sheaf when reaped: the `landscapetypes.ini` `wheat (growing)` reap
 *  transition `transition 11 28 1 1 0` sets the cut pile's valency to 1, and a pile's valency is its unit
 *  count (`wheat (harvested)` piles up by +1 to `maximumValency 5`). */
export const WHEAT_YIELD_PER_FIELD = 1;

/** Strokes a farmer plays per reaped field, transcribed from `humanjobexperiencetypes.ini` type 46
 *  "farmer wheat" `baserepeatcounter 2`. Approximation: which of the three field actions the count gates
 *  is not readable, every farmer clip firing one cue per play; the scythe is the reading. */
export const WHEAT_WORK_REPEATS = 2;

/** How far from the farm's anchor its farmers sow and fetch sheaves, in half-cell nodes (16 nodes ≈ 8
 *  tiles). The packed sow keeps an open plot within a few nodes, so this bounds the sheaf pickup and the
 *  detours a plot takes around obstacles. */
export const FARM_FIELD_RADIUS = 16;

/** Fields one farm keeps standing at once, whatever its crew size: observed at 24-25 growing plants,
 *  which did not grow when more farmers were assigned. */
export const FARM_MAX_FIELDS = 24;

/** The `farming` block per farmed good, keyed by its stable string id, so wheat farms at the same pace on
 *  either content base. Real ir.json extracts wheat's atomics but not this plot calibration. */
export const FARMING_BALANCE_BY_ID: Readonly<Record<string, GoodFarming>> = {
  wheat: {
    stages: WHEAT_GROWTH_STAGES,
    yieldPerField: WHEAT_YIELD_PER_FIELD,
    fieldRadius: FARM_FIELD_RADIUS,
    maxFields: FARM_MAX_FIELDS,
  },
};
