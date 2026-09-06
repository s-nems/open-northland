import { tileToScreen } from '@open-northland/render';
import { entityById, ONE, type WorldSnapshot } from '@open-northland/sim';
import { isSettler, positionOf } from '../../../game/snapshot.js';

/** A centroid in world px, with the selected ids. */
export interface SelectionCentre {
  readonly x: number;
  readonly y: number;
  readonly ids: readonly number[];
}

/** The selected settlers' centroid in world px, or null when none is selected. */
export const selectionCentre = (
  snapshot: WorldSnapshot,
  selection: ReadonlySet<number>,
): SelectionCentre | null => {
  let wx = 0;
  let wy = 0;
  const ids: number[] = [];
  // Ascending id order keeps the emitted command order deterministic, since a Set iterates in click
  // order.
  for (const id of [...selection].sort((a, b) => a - b)) {
    const e = entityById(snapshot, id);
    if (e === undefined || !isSettler(e)) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const s = tileToScreen(pos.x / ONE, pos.y / ONE); // the drawn feet anchor, in world px
    wx += s.x;
    wy += s.y;
    ids.push(e.id);
  }
  if (ids.length === 0) return null;
  return { x: wx / ids.length, y: wy / ids.length, ids };
};
