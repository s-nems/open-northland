import { FOG_STATE, type FogView } from '@open-northland/sim';
import { rowStagger } from '../projection/index.js';
import { scaleColour } from '../terrain/index.js';

/** Alpha of the black fog wash over the ground, 0-255. An eye-tuned approximation: the explored-grey
 *  band has no original counterpart, and the ghost tint below derives from the same grading. */
export const FOG_UNEXPLORED_ALPHA = 255;
export const FOG_EXPLORED_ALPHA = 140;

/** Ghost sprites draw above the wash, so they multiply in the luminance it would have left them. */
const FOG_GHOST_LUMA = 1 - FOG_EXPLORED_ALPHA / 255;

/** The ghost tint for a sprite with no base shading of its own. */
export const FOG_GHOST_TINT = scaleColour(0xffffff, FOG_GHOST_LUMA);

export function fogGhostTint(base: number): number {
  return scaleColour(base, FOG_GHOST_LUMA);
}

/**
 * The visual cell containing a fractional tile position, matching the sim's
 * `cellOfNode(nodeOfPosition(p))` so both sides agree on which cell hides an entity.
 */
export function fogCellOfTile(tileX: number, tileY: number): { cx: number; cy: number } {
  // The sim's node lattice steps by half a tile, so halve the row stagger.
  const stagger = rowStagger(tileY) / 2;
  return { cx: Math.floor(tileX + stagger), cy: Math.floor(tileY) };
}

/** Whether a tile position is visible to the fog view's player. Authored rule: the explored-grey
 *  layer shows terrain only, so an entity on merely-explored ground is culled. */
export function fogTileVisible(view: FogView, tileX: number, tileY: number): boolean {
  const { cx, cy } = fogCellOfTile(tileX, tileY);
  return view.stateAt(cx, cy) === FOG_STATE.VISIBLE;
}
