import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import { type ElevationField, projectTile } from '../../data/terrain/index.js';
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
  return projectTile(elevation, pos.x / ONE, pos.y / ONE);
}

/** An entity wearing a mark: the retained-pool key and the snapshot `Position` in fixed-point units. */
export interface MarkedEntity {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** The per-frame geometry a mark anchor reads: the pool's drawn sprites and the terrain height field. */
export interface MarkAnchorFrame {
  readonly drawn?: DrawnGeometry | undefined;
  readonly elevation?: ElevationField | undefined;
}

/**
 * Where a mark floats over `entity`: the pool's drawn sprite-bounds top-centre, else the feet anchor
 * raised by `riseAboveFeet` world px. `undefined` means culled and the caller draws nothing.
 *
 * The cull runs on the raw projection first, so an off-screen entity pays no pool lookup or terrain
 * lift. The viewport's sprite-cull margin covers the raw-vs-drawn anchor gap and the rise.
 */
export function markAnchor(
  frame: MarkAnchorFrame,
  entity: MarkedEntity,
  riseAboveFeet: number,
  viewport: Viewport | undefined,
): { x: number; y: number } | undefined {
  const feet = tileToScreen(entity.x / ONE, entity.y / ONE);
  if (viewport !== undefined && !isVisible(viewport, feet.x, feet.y)) return undefined;

  const bounds = frame.drawn?.boundsOf(entity.id);
  if (bounds !== undefined) return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY };
  const anchor = feetAnchor(frame.drawn, entity.id, entity, frame.elevation);
  return { x: anchor.x, y: anchor.y - riseAboveFeet };
}
