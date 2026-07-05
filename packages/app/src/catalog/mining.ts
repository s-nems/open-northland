/**
 * OBSERVED mining calibration — the ONE global source for the mineral-deposit sizes + level counts, so
 * "how many units a deposit holds" and "how many fill levels it shrinks through" are NEVER re-picked per
 * scene. Every scene that plants a mined good (stone/iron/gold/clay) builds its `gathering` params AND its
 * deposits' `MineDeposit`/`Resource` from THESE constants, so the mining pace can't drift between scenes
 * (the recurring per-scene-magic-number complaint). Add a new mined good's calibration here, not in the
 * scene. Mirrors {@link import('./felling.js')} for the felling half of the gathering pipeline.
 *
 * OBSERVED, pending calibration against the original (docs/FIDELITY.md "Mineral deposits") — the original's
 * readable data carries no deposit size. This is the SCENE lever; the REAL-content lever is separate: the
 * pipeline's `extractGoodGathering` emits `0` (not a deposit) until the value is pinned into the mod data,
 * so the live game does not yet mine. Keep the two in mind together when the number is finally calibrated.
 */

/**
 * The units a mineral deposit holds — each chipped off one at a time as an ore pile the collector carries
 * off, the deposit shrinking a visual level as it drains. A modest count so a scene depletes a deposit
 * within its run while still reading as "a deposit holds MANY units" (unlike a fell-once tree).
 */
export const STONE_DEPOSIT_UNITS = 8;
export const CLAY_DEPOSIT_UNITS = 10;
export const IRON_DEPOSIT_UNITS = 8;
export const GOLD_DEPOSIT_UNITS = 6;

/**
 * The discrete visual fill states a mineral deposit steps down through as it empties. OBSERVED = the
 * `ls_ground` clay/iron/gold mine `[GfxLandscape]` records each carry **5** fill states (`state 5` full →
 * `state 1` dregs); the sim buckets `remaining/depositSize` into this many levels so the drawn mine
 * shrinks in step with what has been mined (docs/FIDELITY.md "Mineral deposits").
 */
export const MINE_LEVELS = 5;
