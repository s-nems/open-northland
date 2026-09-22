import type { ContentSet } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { settlerJobType } from '../../game/snapshot.js';
import { type Pickable, pickInRect } from '../picking.js';

// Original behavior, unconfirmed against the running original: a double-click on a selected settler
// gathers its trade from an 800 x 600 world-px window centred on the cursor.
const WINDOW_HALF_WIDTH = 400;
const WINDOW_HALF_HEIGHT = 300;

/** What a double-click matches on: the original counts every hero as one trade. */
type TradeKey = number | 'hero' | undefined;

function tradeKeyOf(content: ContentSet, snapshot: WorldSnapshot, ref: number): TradeKey {
  const entity = entityById(snapshot, ref);
  const job = entity === undefined ? undefined : settlerJobType(entity);
  return job !== undefined && systems.isHeroJob(content, job) ? 'hero' : job;
}

/**
 * The drawn own `settlers` of `clicked`'s trade in the window around `at`, or null when `clicked` is not
 * one of them, such as a building. Approximation: a settler counts when its feet stand in the window, as
 * a drag select tests, where the original takes any sprite that touches it.
 */
export function jobMatesAround(
  settlers: readonly Pickable[],
  clicked: number,
  at: { readonly x: number; readonly y: number },
  snapshot: WorldSnapshot,
  content: ContentSet,
): number[] | null {
  if (!settlers.some((s) => s.ref === clicked)) return null;
  const trade = tradeKeyOf(content, snapshot, clicked);
  const inWindow = pickInRect(
    settlers,
    at.x - WINDOW_HALF_WIDTH,
    at.y - WINDOW_HALF_HEIGHT,
    at.x + WINDOW_HALF_WIDTH,
    at.y + WINDOW_HALF_HEIGHT,
  );
  return inWindow.filter((ref) => tradeKeyOf(content, snapshot, ref) === trade);
}
