/**
 * A transition lane's "no overlay here" sentinel (u8 max) — the shared half of the `emt1..emt4`
 * encoding contract between the pipeline's lane validation, this schema's refine, and the render's
 * decode (`packages/render/src/data/terrain.ts` keeps a documented local twin — that package stays
 * import-decoupled from `@open-northland/data` by design).
 */
export const TRANSITION_NONE = 255;

/**
 * The pair variants each `[transition]` record carries (six `GfxCoordsA`/`GfxCoordsB` lines) — the
 * divisor of the `emt` lane encoding: `⌊value / 6⌋` picks the record, `value % 6` the pair. Shared
 * like {@link TRANSITION_NONE}.
 */
export const TRANSITION_PAIRS = 6;
