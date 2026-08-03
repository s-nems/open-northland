import { ONE, tileToScreen } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';

/**
 * An entity's feet point in world space: the sprite pool's drawn anchor when it drew the entity this
 * frame, else the projection of `pos` (fixed-point snapshot `Position`) dropped onto the sloped ground.
 */
export function feetAnchor(
  drawn: DrawnGeometry | undefined,
  id: number,
  pos: { readonly x: number; readonly y: number },
  elevation: ElevationField | undefined,
): { x: number; y: number } {
  const anchor = drawn?.anchorOf(id);
  if (anchor !== undefined) return anchor;
  const tileX = pos.x / ONE;
  const tileY = pos.y / ONE;
  const p = tileToScreen(tileX, tileY);
  return { x: p.x, y: p.y - terrainLiftAt(elevation, tileX, tileY) };
}
