import { type ElevationField, ONE, projectTile } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { positionOf } from '../../game/snapshot.js';

/** The world-px ground anchor an entity stands on: {@link projectTile} of its snapshot position. Null
 *  when the id names no positioned entity. */
export function entityAnchor(
  snapshot: WorldSnapshot,
  id: number,
  elevation?: ElevationField,
): { x: number; y: number } | null {
  const entity = entityById(snapshot, id);
  const pos = entity === undefined ? undefined : positionOf(entity);
  if (pos === undefined) return null;
  return projectTile(elevation, pos.x / ONE, pos.y / ONE);
}
