import { type ElevationField, ONE, projectNode, projectTile } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { positionOf } from '../../game/snapshot.js';
import type { MessageTarget } from '../../hud/tool-panel/messages/index.js';

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

/** Where a note's Select centres the view: the subject's anchor while it lives, else the half-cell node
 *  the message was raised at, else nowhere. */
export function messageTargetAnchor(
  snapshot: WorldSnapshot,
  target: MessageTarget,
  elevation?: ElevationField,
): { x: number; y: number } | null {
  const anchor = target.entity === null ? null : entityAnchor(snapshot, target.entity, elevation);
  if (anchor !== null) return anchor;
  return target.at === null ? null : projectNode(elevation, target.at.hx, target.at.hy);
}
