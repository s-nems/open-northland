import type { ContentSet } from '@open-northland/data';
import { type Camera, cameraViewport, type Viewport } from '@open-northland/render';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { settlerJobType } from '../../game/snapshot.js';
import type { Pickable } from '../picking.js';

/**
 * Screen px of slack past every screen edge, so a settler that just stepped off-screen still counts. The
 * original gathers from a fixed 800 x 600 world-px window around the cursor instead of the whole screen.
 */
const SCREEN_MARGIN = 96;

/**
 * What a double-click matches on. The original counts every hero as one trade; soldiers here count as
 * one trade whatever their weapon, where the original keeps each weapon class apart.
 */
type TradeKey = number | 'hero' | 'soldier' | undefined;

function tradeKeyOf(content: ContentSet, snapshot: WorldSnapshot, ref: number): TradeKey {
  const entity = entityById(snapshot, ref);
  const job = entity === undefined ? undefined : settlerJobType(entity);
  if (job === undefined) return undefined;
  if (systems.isHeroJob(content, job)) return 'hero';
  return systems.isSoldierJob(content, job) ? 'soldier' : job;
}

/** The world rectangle a double-click gathers from: the screen, grown by {@link SCREEN_MARGIN}. */
export function jobMateArea(camera: Camera, screenW: number, screenH: number): Viewport {
  return cameraViewport(camera, screenW, screenH, SCREEN_MARGIN / (camera.scale ?? 1));
}

/** As in the original, a drawn sprite counts when it touches the area; without bounds, its feet must. */
function touches(settler: Pickable, area: Viewport): boolean {
  const b = settler.box ?? { minX: settler.x, minY: settler.y, maxX: settler.x, maxY: settler.y };
  return b.minX <= area.maxX && b.maxX >= area.minX && b.minY <= area.maxY && b.maxY >= area.minY;
}

/**
 * The drawn own `settlers` of `clicked`'s trade in `area`, or null when `clicked` is not one of them,
 * such as a building.
 */
export function jobMatesIn(
  settlers: readonly Pickable[],
  clicked: number,
  area: Viewport,
  snapshot: WorldSnapshot,
  content: ContentSet,
): number[] | null {
  if (!settlers.some((s) => s.ref === clicked)) return null;
  const trade = tradeKeyOf(content, snapshot, clicked);
  return settlers
    .filter((s) => touches(s, area) && tradeKeyOf(content, snapshot, s.ref) === trade)
    .map((s) => s.ref);
}
