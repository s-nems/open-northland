import type { SettlerBubble, SettlerBubbleKind } from '@open-northland/render';
import { isIndoorSettler } from '@open-northland/render/data';
import { indexesOf, listedWhere, type NeedLevels, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  childOrderOf,
  isMarrying,
  isSettler,
  ownedByComputerSeat,
  positionOf,
  type SnapshotEntity,
  settlerNeedsOf,
  storedNeedsOf,
} from '../../game/snapshot.js';

/**
 * Per-settler thought bubbles over the snapshot. The bubble thresholds sit far above the eat and sleep
 * thresholds, so a bubble marks a settler that cannot feed or rest itself rather than one merely due
 * (observed original). A computer seat's settlers float no need bubble ({@link ownedByComputerSeat}), but
 * their family bubbles show like everyone's. Departure: the original floats none over them.
 */
export function computeSettlerBubbles(snapshot: WorldSnapshot): SettlerBubble[] {
  const out: SettlerBubble[] = [];
  for (const e of indexesOf(snapshot).get(BUBBLE_CARRIERS)) {
    if (isIndoorSettler(snapshot, e.components)) continue;
    const kind =
      familyBubbleOf(e) ??
      (ownedByComputerSeat(snapshot, e) ? undefined : needBubbleOf(settlerNeedsOf(e, snapshot.tick)));
    if (kind === undefined) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    out.push({ id: e.id, x: pos.x, y: pos.y, kind });
  }
  return out;
}

/** The settlers some bubble would float over, whatever their seat: a small crowd, so the read scales with
 *  it rather than with the population. The stored bars place a settler, as the critical level is a band
 *  threshold. */
const BUBBLE_CARRIERS = listedWhere(
  (e) => isSettler(e) && (familyBubbleOf(e) ?? needBubbleOf(storedNeedsOf(e))) !== undefined,
  'bubble carriers',
  {
    values: ['SettlerNeeds', 'ChildOrder'],
    presence: ['Settler', 'Wedding'],
  },
);

/** A family bubble outranks a need bubble. */
function familyBubbleOf(e: SnapshotEntity): SettlerBubbleKind | undefined {
  if (childOrderOf(e) !== undefined) return 'child';
  if (isMarrying(e)) return 'partner';
  return undefined;
}

function needBubbleOf(needs: NeedLevels | undefined): SettlerBubbleKind | undefined {
  if (needs === undefined) return undefined;
  if (needs.hunger >= systems.NEED_CRITICAL_THRESHOLD) return 'hungry';
  if (needs.fatigue >= systems.NEED_CRITICAL_THRESHOLD) return 'sleepy';
  return undefined;
}
