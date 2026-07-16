/**
 * OBSERVED felling calibration — the one global source for the multi-hit wood harvest, so "how many chops
 * fell a tree" and "the wood a felled tree yields" are never re-picked per scene. Every scene that plants a
 * fellable wood good builds its `gathering` params and its trees' `Felling`/`Resource` from these constants,
 * so the felling pace can't drift between scenes (the recurring per-scene-magic-number complaint). Add a new
 * fellable good's calibration here, not in the scene.
 *
 * OBSERVED calibration against the original (source basis "Multi-hit harvest / felling"); the original's
 * readable data carries no chop count, so this remains an explicit runtime balance value.
 */

/** Chops needed to fell one three-wood tree. Observed original pacing is 20–25 s per wood: 21 30-tick
 * cycles plus ten 15-tick rests take 780 ticks (65 s per tree, about 21.7 s per wood at 12 ticks/s). */
export const WOOD_CHOPS_TO_FELL = 21;

/** The whole wood a felled tree drops as its trunk on the ground, then carried off in carry-capacity loads. */
export const WOOD_YIELD_PER_NODE = 3;
