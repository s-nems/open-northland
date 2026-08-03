/**
 * Mining calibration: the one source for a mineral deposit's size and level count on every spawn that
 * does not go through the decoded-map join, so no scene re-picks them (`./felling.ts` is the felling
 * half). A decoded map's placement instead sizes its deposit from its own `[GfxLandscape]` record.
 */

/**
 * The units a mineral deposit holds, chipped off one at a time as an ore pile a collector carries off.
 * Observation: one deposit hex holds at most about five units, so an outcrop is a short dig, not a
 * quarry. Gold is pinned smallest as a balance choice; the data authors every gold and iron mine at five.
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
 * The visual fill states a fallback-sized deposit steps down through as it empties. The real count is per
 * `[GfxLandscape]` record (clay, iron and gold mines carry 5, stone's rocks 4 or 5), so a map placement
 * carries its own and this uniform one covers only record-less spawns; the render rescales a mismatch.
 */
export const MINE_LEVELS = 5;
