import { ONE, tileToScreen } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';

/**
 * An entity's feet point in world space, the shared anchor a ground overlay hangs off: the sprite pool's
 * drawn feet anchor when it drew the entity this frame, else the raw snapshot projection of its tile
 * dropped onto the sloped ground. `pos` is the fixed-point snapshot `Position`; the projection and lift
 * are computed only on the fallback path, so a pooled entity pays nothing here.
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
