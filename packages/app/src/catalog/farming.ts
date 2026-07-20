import type { GoodFarming } from '@open-northland/data';

/**
 * The farm's field-cultivation calibration — the one global source for the wheat sow→water→grow→reap
 * loop's numbers: every scene/content set that farms wheat builds its `farming` block from these
 * constants so the pace can't drift per scene.
 *
 * Source split (see the sim's `GoodFarming` schema): {@link WHEAT_GROWTH_STAGES} and
 * {@link WHEAT_WORK_REPEATS} come from readable original data — {@link WHEAT_WORK_REPEATS} hand-pinned
 * here, since the pipeline does not extract `humanjobexperiencetypes.ini` yet
 * (docs/tickets/sim/job-repeat-counter-extraction.md). The rest is calibration observed in the running
 * original; the data carries no growth timing, field radius, or per-field yield.
 *
 * These reproduce the original's measured pacing: one farmer banks ~10 grain per 10 minutes, two ~20,
 * three ~30, four ~40, on a plot that stands at ~24 plants for every one of those crews. Two constants do
 * that between them — {@link WHEAT_WORK_REPEATS} sets what a grain costs in farmer labor (hence the linear
 * ladder), {@link FARM_MAX_FIELDS} sets the plot (hence its independence from the crew).
 */

/** Growth stages a sown field passes through before it is ripe (the `landscapetypes.ini` `wheat (growing)`
 *  lane's `maximumValency 5`, matching the field gfx's 5 growth frames). */
export const WHEAT_GROWTH_STAGES = 5;

/** Nominal ticks a watered field takes per growth stage (an unwatered field does not grow at all —
 *  watering is the sim's growth gate). 500 ticks × 4 stage steps = 2000 ticks ≈ 167 s at 12 ticks/s from
 *  watering to ripe (observed pacing, against the original's slow field turnaround). */
export const WHEAT_TICKS_PER_STAGE = 500;

/** How far a single field's stage length may sit either side of {@link WHEAT_TICKS_PER_STAGE}. At ±40%
 *  a plot the farmers plough in one pass still ripens a few plants at a time instead of all at once —
 *  the original's staggered field, approximated (its per-plant timing is not decoded). */
export const WHEAT_GROWTH_SPREAD_PERCENT = 40;

/** Units a ripe field drops as its cut sheaf when reaped. */
export const WHEAT_YIELD_PER_FIELD = 1;

/** Strokes a farmer plays per field action — `humanjobexperiencetypes.ini` type 46 "farmer wheat"
 *  `baserepeatcounter 2`. This is the farm's throughput dial: a field action is what a grain costs, and
 *  at 2 strokes one farmer banks ~10 grain per 10 minutes, matching the original. */
export const WHEAT_WORK_REPEATS = 2;

/** How far from the farm's anchor its farmers sow, in half-cell nodes (16 nodes ≈ 8 tiles). */
export const FARM_FIELD_RADIUS = 16;

/** Fields one farm keeps standing at once, whatever its crew size — measured in the running original,
 *  where a farm's plot held 24–25 growing plants and did not grow when more farmers were assigned. A
 *  plot this size is also what staggers the harvest: one farmer cannot re-water 24 fields inside a
 *  {@link WHEAT_TICKS_PER_STAGE} window, so the fields drift apart in stage instead of ripening as one
 *  batch. */
export const FARM_MAX_FIELDS = 24;

/** The clean-room field-farming `farming` block per farmed good, keyed by its stable string id — read by both
 *  the sandbox goods builder (`game/sandbox/content/catalog/goods.ts`) and the real-content overlay
 *  (`content/real-content.ts` `mergeRealContent`), so wheat farms at the same pace on either content base.
 *  Real ir.json extracts wheat's plant/cultivate/harvest atomics and its `producedOnMap` flag, but not this
 *  growth timing, so the overlay pins it here. */
export const FARMING_BALANCE_BY_ID: Readonly<Record<string, GoodFarming>> = {
  wheat: {
    stages: WHEAT_GROWTH_STAGES,
    ticksPerStage: WHEAT_TICKS_PER_STAGE,
    growthSpreadPercent: WHEAT_GROWTH_SPREAD_PERCENT,
    yieldPerField: WHEAT_YIELD_PER_FIELD,
    workRepeats: WHEAT_WORK_REPEATS,
    fieldRadius: FARM_FIELD_RADIUS,
    maxFields: FARM_MAX_FIELDS,
  },
};
