import { tileToScreen } from '@open-northland/render';
import { entityById, ONE, type WorldSnapshot } from '@open-northland/sim';
import { isSettler, positionOf, settlerJobType } from '../../../game/snapshot.js';

/** The selected settlers' centroid (WORLD px) plus the ids and their common trade. */
export interface SelectionCentre {
  readonly x: number;
  readonly y: number;
  readonly ids: readonly number[];
  /** The selection's shared trade, or undefined when the selection mixes trades. */
  readonly jobType: number | undefined;
}

/** The selected settlers' centroid in WORLD px, or null when none is selected. Walks the selection and
 *  binary-searches each id: O(selected · log entities). */
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
  // Ascending, because a Set iterates in click order while `ids` reaches the sim as command order (one
  // `setJob` per id) and picks the acting scout for an erect-signpost order. Approximation: which scout
  // the original sends is unobserved, so the lowest id is the deterministic stand-in.
  for (const id of [...selection].sort((a, b) => a - b)) {
    const e = entityById(snapshot, id);
    if (e === undefined || !isSettler(e)) continue;
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
