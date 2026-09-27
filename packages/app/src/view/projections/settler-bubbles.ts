import type { SettlerBubble, SettlerBubbleKind } from '@open-northland/render';
import { indexesOf, listedWhere, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  childOrderOf,
  isMarrying,
  isSettler,
  ownedByComputerSeat,
  positionOf,
  type SnapshotEntity,
  settlerNeedsOf,
} from '../../game/snapshot.js';

/**
 * Per-settler thought bubbles over the snapshot. The bubble thresholds sit far above the eat and sleep
 * thresholds, so a bubble marks a settler that cannot feed or rest itself rather than one merely due
 * (observed original). A computer seat's settlers float none ({@link ownedByComputerSeat}).
 */
export function computeSettlerBubbles(snapshot: WorldSnapshot): SettlerBubble[] {
  const out: SettlerBubble[] = [];
  for (const e of indexesOf(snapshot).get(BUBBLE_CARRIERS)) {
    if (ownedByComputerSeat(snapshot, e)) continue;
    const kind = bubbleKindOf(e);
    if (kind === undefined) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    out.push({ id: e.id, x: pos.x, y: pos.y, kind });
  }
  return out;
}

/** The settlers some bubble would float over, whatever their seat: a small crowd, so the read scales with
 *  it rather than with the population. */
const BUBBLE_CARRIERS = listedWhere((e) => isSettler(e) && bubbleKindOf(e) !== undefined, 'bubble carriers', {
  values: ['Settler', 'ChildOrder'],
  presence: ['Wedding'],
});

function bubbleKindOf(e: SnapshotEntity): SettlerBubbleKind | undefined {
  if (childOrderOf(e) !== undefined) return 'child';
  if (isMarrying(e)) return 'partner';
  const needs = settlerNeedsOf(e);
  if (needs === undefined) return undefined;
  if (needs.hunger >= systems.NEED_CRITICAL_THRESHOLD) return 'hungry';
  if (needs.fatigue >= systems.NEED_CRITICAL_THRESHOLD) return 'sleepy';
  return undefined;
}
