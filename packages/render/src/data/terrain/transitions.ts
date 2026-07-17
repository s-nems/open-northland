/**
 * The transition-overlay lane decode (the map's `emt1..emt4` lanes) — one packed u8 per triangle into the
 * transition record + pair variant the mesh builder samples.
 *
 * These two constants duplicate `@open-northland/data`'s `TRANSITION_NONE` / `TRANSITION_PAIRS`
 * (which the map schema + pipeline validate with) to keep this module import-decoupled from
 * `@open-northland/data`; a change to the encoding must touch both sites.
 */

/** A transition lane's "no overlay here" sentinel (u8 max). */
export const TRANSITION_NONE = 255;

/** The pair variants each `[transition]` record carries (six `GfxCoordsA`/`GfxCoordsB` lines). */
const TRANSITION_PAIRS = 6;

/**
 * Decode one transition-lane value: `v < 255` selects transition `⌊v/6⌋` (an index into the map's
 * `transitions.types` dictionary) and pair variant `v % 6` (an index into the record's six UV
 * pairs); `255` = no overlay on this triangle.
 */
export function transitionRef(v: number): { readonly transition: number; readonly pair: number } | undefined {
  if (v === TRANSITION_NONE) return undefined;
  return { transition: Math.floor(v / TRANSITION_PAIRS), pair: v % TRANSITION_PAIRS };
}
