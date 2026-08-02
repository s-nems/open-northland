/** A transition lane's "no overlay here" sentinel (u8 max) - one half of the `emt1..emt4` encoding
 *  contract this module owns for the pipeline, the schema refine and the render decode alike. */
export const TRANSITION_NONE = 255;

/**
 * The pair variants each `[transition]` record carries (six `GfxCoordsA`/`GfxCoordsB` lines) - the
 * divisor of the `emt` lane encoding: `⌊value / 6⌋` picks the record, `value % 6` the pair. Shared
 * like {@link TRANSITION_NONE}.
 */
export const TRANSITION_PAIRS = 6;
