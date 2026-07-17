import { FOG_STATE, type FogView } from '@open-northland/sim';
import { rowStagger } from '../projection/index.js';
import { scaleColour } from '../terrain/index.js';

/**
 * Render-side fog-of-war helpers — the thin data layer between the sim's {@link FogView} (per-cell
 * tri-state mask for the viewer player, `Simulation.fogView`) and the GPU consumers (the fog wash,
 * the sprite cull, the tall map-object gate, the ghost tint). Pure math, no Pixi — headlessly
 * unit-testable like the rest of `render`'s data layer. Floats are fine here (render never feeds
 * the sim).
 */

/** Per-state fog-wash mask alpha (black texels over the ground): unexplored hides everything,
 *  explored dims to "known terrain, not watched", visible shows through. Owned here (not in the GPU
 *  wash) so the ghost tint below derives from the same grading — a ghost sprite drawn above the wash
 *  reads exactly as dark as the explored ground it stands on. The alphas are tuned by eye (the grey
 *  layer is our modern addition — source basis "observed original behaviour"; a human signs off). */
export const FOG_UNEXPLORED_ALPHA = 255;
export const FOG_EXPLORED_ALPHA = 140;

/** The luminance factor a black wash of {@link FOG_EXPLORED_ALPHA} leaves: `1 − α/255`. Ghost sprites
 *  sit above the wash (the depth-sorted entity layer), so they multiply this in via tint instead. */
const FOG_GHOST_LUMA = 1 - FOG_EXPLORED_ALPHA / 255;

/** {@link fogGhostTint} of plain white — the tint for a ghost sprite with no base shading. */
export const FOG_GHOST_TINT = scaleColour(0xffffff, FOG_GHOST_LUMA);

/** Darken a sprite's base tint to the explored-grey grading — the "remembered ghost" look for a
 *  once-seen static (building/resource) drawn on ground the viewer no longer watches. */
export function fogGhostTint(base: number): number {
  return scaleColour(base, FOG_GHOST_LUMA);
}

/**
 * The visual cell containing a fractional tile position — the render twin of the sim's
 * `cellOfNode(nodeOfPosition(p))` (halfcell.ts: `hx = ⌊(x + stagger(y))·2⌋`, cell = `hx>>1` =
 * `⌊x + stagger(y)⌋`; `cy = ⌊y⌋`). The stagger is the same triangle wave `tileToScreen` interpolates
 * (0 at even rows, ½ cell at odd, linear between), so a walking entity resolves to the same cell the
 * sim's vision mask stamped — the two sides can't disagree about which cell hides a unit.
 */
export function fogCellOfTile(tileX: number, tileY: number): { cx: number; cy: number } {
  // Half the tile stagger — the half-cell step of the sim's `nodeOfPosition` (see the doc above).
  const stagger = rowStagger(tileY) / 2;
  return { cx: Math.floor(tileX + stagger), cy: Math.floor(tileY) };
}

/**
 * Whether a fractional tile position is fully visible to the fog view's player — the per-entity cull
 * predicate the sprite pool applies (an entity in an unexplored/explored-only cell is not drawn;
 * user decision 2026-07-11: the grey layer shows terrain only, no entities/resources).
 */
export function fogTileVisible(view: FogView, tileX: number, tileY: number): boolean {
  const { cx, cy } = fogCellOfTile(tileX, tileY);
  return view.stateAt(cx, cy) === FOG_STATE.VISIBLE;
}
