/**
 * Mining calibration — the one global source for mineral-deposit sizes and level counts, so a mined good's
 * unit count and shrink-level count are not re-picked per scene (`./felling.ts` is the felling half).
 *
 * Deposit sizes are observed (source basis "Mineral deposits"), demonstrative pending calibration: the
 * readable data has no established harvestable-unit-count field (`landscapetypes.ini` `maximumValency` is a
 * per-cell valency, constant across a good's stages — e.g. mud_mine = mud_ore = mud = 6). {@link MINE_LEVELS}
 * is gfx data instead.
 */

/**
 * The units a mineral deposit holds, chipped off one at a time as an ore pile a collector carries off.
 * Observed original behaviour (user recollection 2026-07-16, no readable unit-count source): one deposit hex
 * holds at most about five units, so an outcrop is a short dig, not a quarry. Gold is pinned smallest (the
 * scarcest ore).
 */
export const STONE_DEPOSIT_UNITS = 5;
export const CLAY_DEPOSIT_UNITS = 5;
export const IRON_DEPOSIT_UNITS = 4;
export const GOLD_DEPOSIT_UNITS = 3;

/** Full strikes needed for one hard-mineral unit. Observed original pacing is 20–25 s: eight 29-tick
 * cycles plus three 15-tick rests take 277 ticks (about 23.1 s at 12 ticks/s). */
export const HARD_MINE_STRIKES_PER_UNIT = 8;

/** Full digs needed for one clay unit. Its shorter clip needs nine 23-tick cycles plus four rests,
 * totaling 267 ticks (about 22.3 s at 12 ticks/s). */
export const CLAY_MINE_STRIKES_PER_UNIT = 9;

/**
 * The visual fill states a mineral deposit steps down through as it empties (gfx data: the `[GfxLandscape]`
 * record's own state count, `frames.length`/`maxValency`). The data is per-good — the `ls_ground`
 * clay/iron/gold mines carry 5 states (`state 5` full → `state 1` dregs), stone's rocks 4 (some variants 5),
 * mushroom 1 — but no per-good constant is needed here: the sim buckets `remaining/depositSize` into
 * `MINE_LEVELS` uniformly and the render rescales that ladder onto each drawn record's own state count
 * (`resource-gfx.ts` `resolveResourceDraw` via `DrawItem.levels`).
 */
export const MINE_LEVELS = 5;
