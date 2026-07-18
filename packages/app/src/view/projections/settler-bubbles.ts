import type { SettlerBubble } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { childOrderOf, isMarrying, isSettler, positionOf } from '../../game/snapshot.js';

/**
 * The settler-bubble projection — turn the frozen snapshot into the per-settler thought bubbles the
 * render {@link SettlerBubble} layer floats over a settler's head. It reads the standing family state the
 * sim's FamilySystem drives:
 *  - a woman with a make-child order (`ChildOrder`) shows the `child` bubble until the birth completes;
 *  - either partner walking through a wedding (`Wedding`) shows the `partner` bubble until they marry.
 *
 * Pure over the snapshot (unit-tested), called once per frame. The bubble anchors on the settler's own
 * `Position` — the render layer projects it with the same interpolated iso math as the settler bob, so
 * the bubble rides along. `child` wins if both somehow hold (a woman's make-child order outlives her
 * wedding, which is already over by then).
 */
export function computeSettlerBubbles(snapshot: WorldSnapshot): SettlerBubble[] {
  const out: SettlerBubble[] = [];
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const kind = childOrderOf(e) !== undefined ? 'child' : isMarrying(e) ? 'partner' : undefined;
    if (kind === undefined) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    out.push({ id: e.id, x: pos.x, y: pos.y, kind });
  }
  return out;
}
