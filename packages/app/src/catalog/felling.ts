/**
 * OBSERVED felling calibration — the one global source for the multi-hit wood harvest, so "how many chops
 * fell a tree" and "the wood a felled tree yields" are never re-picked per scene. Every scene that plants a
 * fellable wood good builds its `gathering` params and its trees' `Felling`/`Resource` from these constants,
 * so the felling pace can't drift between scenes (the recurring per-scene-magic-number complaint). Add a new
 * fellable good's calibration here, not in the scene.
 *
 * OBSERVED, pending calibration against the original (source basis "Multi-hit harvest / felling") — the
 * original's data carries no chop count. This is the scene lever; the real-content lever is separate: the
 * pipeline's `extractGoodGathering` emits `0` (single-hit) until the value is pinned into the mod data, so
 * the live game does not yet fell. Keep the two in mind together when the number is finally calibrated.
 */

/** Chops (harvest-swing atomics) a woodcutter lands to bring a tree down. Recalibrated 6 → 12 by
 *  observed pacing: at 6 a whole tree (3 wood) came down in the time a miner chipped 2 stone, and
 *  bringing a tree down should read a touch slower than that ("drzewo niech trochę dłużej") — at 12
 *  a felling event is ~435 ticks vs ~408 for 2 mined stone. Per gathered unit wood stays the
 *  cheaper good (3 wood per felling); the calibration targets the felling event, not the unit. */
export const WOOD_CHOPS_TO_FELL = 12;

/** The whole wood a felled tree drops as its trunk on the ground, then carried off in carry-capacity loads. */
export const WOOD_YIELD_PER_NODE = 3;
