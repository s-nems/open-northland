import type { SettlerBubble, SettlerBubbleKind } from '@open-northland/render';
import { systems, type WorldSnapshot } from '@open-northland/sim';
import {
  actorsOf,
  childOrderOf,
  isMarrying,
  isSettler,
  positionOf,
  type SnapshotEntity,
  settlerNeedsOf,
} from '../../game/snapshot.js';

/**
 * Per-settler thought bubbles over the snapshot. The bubble thresholds sit far above the eat and sleep
 * thresholds, so a bubble marks a settler that cannot feed or rest itself rather than one merely due
 * (observed original).
 */
export function computeSettlerBubbles(snapshot: WorldSnapshot): SettlerBubble[] {
  const out: SettlerBubble[] = [];
  for (const e of actorsOf(snapshot)) {
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
