/**
 * Mining calibration - the one source for a mineral deposit's size and level count on every spawn that
 * does not go through the decoded-map join, so they are not re-picked per scene (`./felling.ts` is the
 * felling half). That covers every hand-authored scene, the admin place-resource command, and the
 * per-good `gathering` block `./gathering.ts` stamps into both content bases. A decoded map's placement
 * instead sizes its deposit from its own `[GfxLandscape]` record (`game/sandbox/map-spawn.ts`
 * `withRecordDeposit`), which is data.
 */

/**
 * The units a mineral deposit holds, chipped off one at a time as an ore pile a collector carries off.
 * Observed original behaviour (user recollection 2026-07-16): one deposit hex holds at most about five
 * units, so an outcrop is a short dig, not a quarry. Gold is pinned smallest (the scarcest ore) - a scene
 * balance choice, not the data, which authors every gold and iron mine at five.
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
 * The visual fill states a fallback-sized mineral deposit steps down through as it empties (gfx data: the
 * `[GfxLandscape]` record's own state count, `frames.length`/`maxValency`). The data is per-record - the
 * `ls_ground` clay/iron/gold mines carry 5 states (`state 5` full → `state 1` dregs), stone's rocks 4 or 5 -
 * so a map placement carries its own count and this uniform one covers only the record-less spawns. The
 * render rescales a ladder that does not match the drawn record's state count (`resolveResourceDraw` via
 * `DrawItem.levels`).
 */
export const MINE_LEVELS = 5;
