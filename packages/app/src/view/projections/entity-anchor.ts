import { type ElevationField, ONE, terrainLiftAt, tileToScreen } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { positionOf } from '../../game/snapshot.js';

/**
 * The world-px point an entity is drawn at: its projected base anchor minus the terrain lift, matching
 * render's `feetAnchor` fallback path. Null when the id names no positioned entity.
 */
export function entityAnchor(
  snapshot: WorldSnapshot,
  id: number,
  elevation?: ElevationField,
): { x: number; y: number } | null {
  const entity = entityById(snapshot, id);
  const pos = entity === undefined ? undefined : positionOf(entity);
  if (pos === undefined) return null;
  const tileX = pos.x / ONE;
  const tileY = pos.y / ONE;
  const p = tileToScreen(tileX, tileY);
  return { x: p.x, y: p.y - terrainLiftAt(elevation, tileX, tileY) };
}
