/**
 * Felling calibration: the one global source for the multi-hit wood harvest, so chops-to-fell and a
 * felled tree's yield are never re-picked per scene. Observed against the original (source basis
 * "Multi-hit harvest / felling"), whose readable data carries no chop count.
 */

/** Chops needed to fell one three-wood tree. Observed original pacing is 20–25 s per wood: 21 30-tick
 * cycles plus ten 15-tick rests take 780 ticks (65 s per tree, about 21.7 s per wood at 12 ticks/s). */
export const WOOD_CHOPS_TO_FELL = 21;

/** The whole wood a felled tree drops as its trunk on the ground, then carried off in carry-capacity loads. */
export const WOOD_YIELD_PER_NODE = 3;
