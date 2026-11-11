import type { DrawItem, EntityBounds } from '@open-northland/render';
import { containsTargetPoint, isHitTarget, type Pickable } from '../picking.js';

/** World px a road plot's click box reaches past its drawn plot. Tuned by eye. */
export const ROAD_PLOT_PICK_MARGIN = 2;

/** What one walk of the drawn frame found for a world point. */
export interface PointScan {
  /** The hit targets whose click box holds the point, in draw order. Ownership and solid pixels are the
   *  reader's to test. */
  readonly items: readonly DrawItem[];
  /** Every drawn resource hit target, under the point or not. */
  readonly resources: ReadonlySet<number>;
}

export interface PointScanDeps {
  readonly drawnItems: () => readonly DrawItem[];
  readonly boundsOf: ((ref: number) => EntityBounds | undefined) | undefined;
}

/** The click box a point query tests an item of this kind with, or null for a kind no query reads. */
function boxKindOf(item: DrawItem): NonNullable<Pickable['kind']> | null {
  switch (item.kind) {
    case 'settler':
    case 'building':
    case 'palisade':
    case 'roadsite':
    case 'vehicle':
    case 'chest':
    case 'resource':
    case 'signpost':
      return item.kind;
    case 'stockpile':
    case 'grounddrop':
      return 'pile';
    default:
      return null;
  }
}

/** A drop-off flag and a claimed site's work flag stand for a settler and hit as a settler's box does. */
function standsForSettler(item: DrawItem): boolean {
  return item.isFlag === true || item.palisadeSite === 'claimed' || item.roadSite === 'claimed';
}

/**
 * The drawn items under a world point, walked once per point within one task. A frame asks about the
 * same pointer for the selection cursor and for the action hint, and each of their queries would
 * otherwise walk every drawn item and read its bounds. The renderer redraws in a task of its own frame,
 * so the answer is dropped when the task ends. The returned scan is reused by the next walk.
 */
export function createPointScan(deps: PointScanDeps): (wx: number, wy: number) => PointScan {
  const items: DrawItem[] = [];
  const resources = new Set<number>();
  const scan: PointScan = { items, resources };
  let held = false;
  let heldX = 0;
  let heldY = 0;
  let heldDrawn: readonly DrawItem[] | null = null;
  const forget = (): void => {
    held = false;
    heldDrawn = null;
  };
  return (wx, wy) => {
    const drawn = deps.drawnItems();
    if (held && wx === heldX && wy === heldY && drawn === heldDrawn) return scan;
    if (!held) queueMicrotask(forget);
    held = true;
    heldX = wx;
    heldY = wy;
    heldDrawn = drawn;
    items.length = 0;
    resources.clear();
    for (const item of drawn) {
      if (!isHitTarget(item)) continue;
      if (item.kind === 'resource') resources.add(item.ref);
      const kind = boxKindOf(item);
      const flag = standsForSettler(item);
      if (kind === null && !flag) continue;
      const box = deps.boundsOf?.(item.ref);
      const margin = kind === 'roadsite' ? ROAD_PLOT_PICK_MARGIN : 0;
      if (
        (kind !== null && containsTargetPoint(kind, item.x, item.y, box, wx, wy, margin)) ||
        (flag && containsTargetPoint('settler', item.x, item.y, box, wx, wy))
      )
        items.push(item);
    }
    return scan;
  };
}
