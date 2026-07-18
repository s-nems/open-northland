import { tileToScreen } from '@open-northland/render';
import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { isSettler, positionOf, settlerJobType } from '../../../game/snapshot.js';

/** The selected settlers' centroid (WORLD px) plus the ids and their common trade. */
export interface SelectionCentre {
  readonly x: number;
  readonly y: number;
  readonly ids: number[];
  /** The selection's shared trade, or undefined when the selection mixes trades. */
  readonly jobType: number | undefined;
}

/** The selected settlers' centroid in WORLD px, or null when none is selected. */
export const selectionCentre = (
  snapshot: WorldSnapshot,
  selection: ReadonlySet<number>,
): SelectionCentre | null => {
  let wx = 0;
  let wy = 0;
  const ids: number[] = [];
  // The selection's common trade (undefined when mixed) — picks the per-profession menu variant.
  let jobType: number | undefined;
  let mixed = false;
  for (const e of snapshot.entities) {
    if (!selection.has(e.id) || !isSettler(e)) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const s = tileToScreen(pos.x / ONE, pos.y / ONE); // the drawn feet anchor (world px)
    wx += s.x;
    wy += s.y;
    const job = settlerJobType(e);
    if (ids.length === 0) jobType = job;
    else if (job !== jobType) mixed = true;
    ids.push(e.id);
  }
  if (ids.length === 0) return null;
  return { x: wx / ids.length, y: wy / ids.length, ids, jobType: mixed ? undefined : jobType };
};
