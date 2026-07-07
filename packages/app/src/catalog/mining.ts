/**
 * OBSERVED mining calibration — the ONE global source for the mineral-deposit sizes + level counts, so
 * "how many units a deposit holds" and "how many fill levels it shrinks through" are NEVER re-picked per
 * scene. Every scene that plants a mined good (stone/iron/gold/clay) builds its `gathering` params AND its
 * deposits' `MineDeposit`/`Resource` from THESE constants, so the mining pace can't drift between scenes
 * (the recurring per-scene-magic-number complaint). Add a new mined good's calibration here, not in the
 * scene. Mirrors {@link import('./felling.js')} for the felling half of the gathering pipeline.
 *
 * The deposit SIZE is genuinely OBSERVED (source basis "Mineral deposits"): the readable data has no
 * field established to be the harvestable-unit count — `landscapetypes.ini` `maximumValency` is a per-cell
 * valency (constant across a good's stages, e.g. mud_mine = mud_ore = mud = 6), not the count. So these
 * sizes are demonstrative, pending calibration against the original; the pipeline emits `0` (not a deposit)
 * until observed. The level COUNT below is DIFFERENT — it is gfx DATA, not observed.
 */

/**
 * The units a mineral deposit holds — each chipped off one at a time as an ore pile the collector carries
 * off, the deposit shrinking a visual level as it drains. OBSERVED (no readable unit-count source) — a
 * modest count so a scene depletes a deposit within its run while still reading as "a deposit holds MANY
 * units" (unlike a fell-once tree). Demonstrative until calibrated against the original.
 */
export const STONE_DEPOSIT_UNITS = 8;
export const CLAY_DEPOSIT_UNITS = 10;
export const IRON_DEPOSIT_UNITS = 8;
export const GOLD_DEPOSIT_UNITS = 6;

/**
 * The discrete visual fill states a mineral deposit steps down through as it empties — DATA, not observed:
 * this IS the mine's `[GfxLandscape]` record's own state count (`frames.length`/`maxValency`), which the
 * render already reads directly (`resource-gfx.ts` `nodeLevelBobs`). It is PER-GOOD: the `ls_ground`
 * clay/iron/gold mines carry **5** fill states (`state 5` full → `state 1` dregs), stone's representative
 * rock carries **4**, mushroom **1**. `MINE_LEVELS` is the 5-state case the scene mines (mud); a real
 * per-good spawn (Step 6) reads each good's own frame count (a stone deposit → 4). The sim buckets
 * `remaining/depositSize` into this many levels so the drawn mine shrinks in step with what has been mined.
 */
export const MINE_LEVELS = 5;
