/**
 * OBSERVED felling calibration — the ONE global source for the multi-hit wood harvest, so "how many chops
 * fell a tree" and "the wood a felled tree yields" are NEVER re-picked per scene. Every scene that plants a
 * fellable wood good builds its `gathering` params AND its trees' `Felling`/`Resource` from THESE constants,
 * so the felling pace can't drift between scenes (the recurring per-scene-magic-number complaint). Add a new
 * fellable good's calibration here, not in the scene.
 *
 * OBSERVED, pending calibration against the original (source basis "Multi-hit harvest / felling") — the
 * original's data carries no chop count. This is the SCENE lever; the REAL-content lever is separate: the
 * pipeline's `extractGoodGathering` emits `0` (single-hit) until the value is pinned into the mod data, so
 * the live game does not yet fell. Keep the two in mind together when the number is finally calibrated.
 */

/** Chops (harvest-swing atomics) a woodcutter lands to bring a tree down. */
export const WOOD_CHOPS_TO_FELL = 6;

/** The whole wood a felled tree drops as its trunk on the ground, then carried off in carry-capacity loads. */
export const WOOD_YIELD_PER_NODE = 3;
