/** The `emt1..emt4` lane sentinel for "no overlay here" (u8 max). */
export const TRANSITION_NONE = 255;

/**
 * The pair variants each `[transition]` record carries (six `GfxCoordsA`/`GfxCoordsB` lines), and the
 * divisor of the `emt` lane encoding: `⌊value / 6⌋` picks the record, `value % 6` the pair.
 */
export const TRANSITION_PAIRS = 6;
