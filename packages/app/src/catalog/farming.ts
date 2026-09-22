import type { GoodFarming } from '@open-northland/data';

/**
 * The field-cultivation calibration: the one global source for the sow, water and reap loop, so its pace
 * cannot drift per scene. The original farms every field-farmed good the same way, reached from both
 * the farmer's and the herb guy's job, parameterized only by the good's `goodtypes.ini` lanes and
 * atomics, so wheat and herb share one block.
 * The vocabulary, the stage count, the cap and the yield are readable data or original behavior; the radius
 * and the plant packing are approximations. The observed target is about 10 grain per farmer per 10
 * minutes, which an idealized farm without hunger or sleep runs well above.
 */

/** Growth stages a sown field passes through before it is ripe, one per watering. Original behavior: a
 *  farmer waters a field whose valency is below 5 and reaps at 5, the
 *  `landscapetypes.ini` `maximumValency 5` of the wheat and herb growing lanes. */
export const FIELD_GROWTH_STAGES = 5;

/** Units a ripe field drops as its cut pile when reaped: the `landscapetypes.ini` reap transitions set
 *  the cut pile's valency to 1 (`wheat (growing)` `transition 11 28 1 1 0`, `herbmine` `transition 11 34
 *  1 1 0`), and a pile's valency is its unit count (`wheat (harvested)` piles up by +1 to
 *  `maximumValency 5`). */
export const FIELD_YIELD_PER_FIELD = 1;

/** Strokes a farmer plays per reaped field, transcribed from `humanjobexperiencetypes.ini` type 46
 *  "farmer wheat" `baserepeatcounter 2`. Approximation: which of the three field actions the count gates
 *  is not readable, every farmer clip firing one cue per play; the scythe is the reading. The herb track
 *  (type 56) names no counter, so a herbalist reaps in one stroke. */
export const WHEAT_WORK_REPEATS = 2;

/** How far from the workplace's anchor its workers sow and fetch piles, in half-cell nodes (16 nodes ≈ 8
 *  tiles). Approximation of the original's search extent: the pile search runs 10 map points out from
 *  the work centre for the farmer and the herb guy alike, 20 for every other trade, and the field and
 *  plantable-spot searches the same 10;
 *  that hexagon is read here as a Manhattan diamond. The packed sow keeps an open plot within a few nodes,
 *  so this bounds the pile pickup and the detours a plot takes around obstacles. */
export const FARM_FIELD_RADIUS = 16;

/** Fields one workplace keeps standing at once, whatever its crew size. Original behavior: a worker plants
 *  only while fewer than 25 fields stand. */
export const FARM_MAX_FIELDS = 25;

/** The one shared block, since the original farms by the good's data alone. */
const FIELD_FARMING: GoodFarming = {
  stages: FIELD_GROWTH_STAGES,
  yieldPerField: FIELD_YIELD_PER_FIELD,
  fieldRadius: FARM_FIELD_RADIUS,
  maxFields: FARM_MAX_FIELDS,
};

/** The `farming` block per farmed good, keyed by its stable string id, so a good farms at the same pace on
 *  either content base. Real ir.json extracts each good's atomics but not this plot calibration. Mushroom
 *  carries the three atomics too but its growing lane is picked directly (`mushroommine` has no reap
 *  transition) and no building produces it, so it stays out. */
export const FARMING_BALANCE_BY_ID: Readonly<Record<string, GoodFarming>> = {
  wheat: FIELD_FARMING,
  herb: FIELD_FARMING,
};
