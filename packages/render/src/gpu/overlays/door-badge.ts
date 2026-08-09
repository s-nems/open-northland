import { ONE, tileToScreen } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { DoorBadgeRow } from './sign-gfx.js';

/** One building's badge data: its stack anchor (snapshot `Position` fixed-point units + an optional
 *  screen-px offset) and the bottom-to-top sign rows bound to it. */
export interface DoorBadge {
  /** The building entity id - the retained-pool key. */
  readonly id: number;
  /** The owning building's position in fixed-point `Position` units - the depth key, so the stack sorts
   *  with its house wherever the post stands. */
  readonly x: number;
  readonly y: number;
  /** Screen-px offset from the projected anchor to the post (+y down); absent = 0. The original's
   *  `GfxFlagPoint`, or the projected step to the derived worker-icon node when a type has none. */
  readonly dx?: number;
  readonly dy?: number;
  /** The owning player slot (0-based `Owner.player`) - selects the sign recolour. */
  readonly player?: number;
  /** Bottom-to-top sign rows; the projection owns the order and the layer draws them as given. */
  readonly rows: readonly DoorBadgeRow[];
  /** True while the resident couple makes love here - draws the hearts over the house. */
  readonly hearts?: boolean;
  /** The garrison this building's roof flies a flag for - the men posted to it, not the ones currently up
   *  there, so the flag does not drop a star every time one climbs down for a meal. Its soldiers stay out
   *  of `rows`: the flag stands for the whole post, one star per man, at its own screen-px offset from
   *  the projected anchor (the mast point, +y down). */
  readonly garrison?: {
    readonly stars: number;
    readonly dx: number;
    readonly dy: number;
  };
}

/** Where one building's door marks stand, in world px (pre-camera). */
export interface BadgeAnchor {
  /** The sign chain's planted base: the authored post offset, minus the terrain lift under the building. */
  readonly x: number;
  readonly y: number;
  /** The garrison mast, lifted the same way. Absent unless the building flies a flag. */
  readonly mast?: { readonly x: number; readonly y: number } | undefined;
  /** The building's own projection before the lift - the key both marks sort and tie-break on, so a mark
   *  planted rows from the door still sorts with its house. */
  readonly depthX: number;
  readonly depthY: number;
}

/** The one owner of that arithmetic: the layer that draws a building's marks and the picker that
 *  hit-tests them stand on the same anchor. */
export function badgeAnchor(badge: DoorBadge, elevation?: ElevationField): BadgeAnchor {
  const tileX = badge.x / ONE;
  const tileY = badge.y / ONE;
  const p = tileToScreen(tileX, tileY);
  const lift = terrainLiftAt(elevation, tileX, tileY);
  const garrison = badge.garrison;
  return {
    x: p.x + (badge.dx ?? 0),
    y: p.y + (badge.dy ?? 0) - lift,
    mast: garrison === undefined ? undefined : { x: p.x + garrison.dx, y: p.y + garrison.dy - lift },
    depthX: p.x,
    depthY: p.y,
  };
}
