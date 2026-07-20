import type { SettlerBubble, SettlerBubbleKind } from '@open-northland/render';
import { systems, type WorldSnapshot } from '@open-northland/sim';
import {
  childOrderOf,
  isMarrying,
  isSettler,
  positionOf,
  type SnapshotEntity,
  settlerNeedsOf,
} from '../../game/snapshot.js';

/**
 * The settler-bubble projection — turn the frozen snapshot into the per-settler thought bubbles the
 * render {@link SettlerBubble} layer floats over a settler's head. It reads the standing family state the
 * sim's FamilySystem drives, then the pressing needs:
 *  - a woman with a make-child order (`ChildOrder`) shows the `child` bubble until the birth completes;
 *  - either partner walking through a wedding (`Wedding`) shows the `partner` bubble until they marry;
 *  - a settler past the sim's `HUNGER_BUBBLE_THRESHOLD` shows the `hungry` bubble. That trigger sits
 *    well above the eat threshold, so a settler that can feed itself eats long before the icon
 *    appears: it reports a famine in the settlement, not one settler being due a meal (observed
 *    original);
 *  - `sleepy` works the same way off `FATIGUE_BUBBLE_THRESHOLD` — a settler that can lie down does so
 *    long before the icon appears, so it marks one that cannot. Hunger wins the tie, the drive-ladder
 *    order.
 *
 * Pure over the snapshot (unit-tested), called once per frame. The bubble anchors on the settler's own
 * `Position` — the render layer projects it with the same interpolated iso math as the settler bob, so
 * the bubble rides along. The family states win over the need bubbles (a rarer, player-ordered beat
 * outranks an ambient status), and `child` wins over `partner` (a woman's make-child order outlives her
 * wedding, which is already over by then).
 */
export function computeSettlerBubbles(snapshot: WorldSnapshot): SettlerBubble[] {
  const out: SettlerBubble[] = [];
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const kind = bubbleKindOf(e);
    if (kind === undefined) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    out.push({ id: e.id, x: pos.x, y: pos.y, kind });
  }
  return out;
}

function bubbleKindOf(e: SnapshotEntity): SettlerBubbleKind | undefined {
  if (childOrderOf(e) !== undefined) return 'child';
  if (isMarrying(e)) return 'partner';
  const needs = settlerNeedsOf(e);
  if (needs === undefined) return undefined;
  if (needs.hunger >= systems.HUNGER_BUBBLE_THRESHOLD) return 'hungry';
  if (needs.fatigue >= systems.FATIGUE_BUBBLE_THRESHOLD) return 'sleepy';
  return undefined;
}
