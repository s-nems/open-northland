import type { ResolvedLayer } from '@open-northland/render';

/** The room a vehicle keeps inside its thumbnail (design px), as a building's body does: the sides, the
 *  bottom and the top, and on a covered card a top that follows the cover, clearing its edge by a few px
 *  up to a cap. */
const VEHICLE_PAD_SIDE = 5;
const VEHICLE_PAD_BOTTOM = 3;
const VEHICLE_PAD_TOP = 5;
const VEHICLE_COVER_CLEARANCE = 2;
const VEHICLE_PAD_TOP_MAX = 24;
/** Canvas px per map px per design px a vehicle may take at most, so a handcart is not blown up. */
const VEHICLE_MAX_ZOOM = 1;

/** A drawn body's box around its feet anchor (map px). */
export interface FigureBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Grow `into` by the frames of `layers` that count towards the body, shadows and swaying overlays left
 *  out; the heave of a ship at sea is left out too, so the box holds still while the hull rides it. */
export function growFigureBounds(
  into: FigureBounds | null,
  layers: readonly ResolvedLayer[],
): FigureBounds | null {
  let out = into;
  for (const layer of layers) {
    if (layer.boundsExempt === true) continue;
    const x = layer.frame.offsetX * layer.scale;
    const y = layer.frame.offsetY * layer.scale;
    const right = x + layer.frame.width * layer.scale;
    const bottom = y + layer.frame.height * layer.scale;
    if (out === null) out = { minX: x, minY: y, maxX: right, maxY: bottom };
    else {
      out.minX = Math.min(out.minX, x);
      out.minY = Math.min(out.minY, y);
      out.maxX = Math.max(out.maxX, right);
      out.maxY = Math.max(out.maxY, bottom);
    }
  }
  return out;
}

/** Where a vehicle's feet go on its canvas (canvas px) and its zoom (canvas px per map px). */
export interface FigureFit {
  readonly zoom: number;
  readonly feetX: number;
  readonly feetY: number;
}

/** Contain `bounds` in the canvas inside the thumbnail's padding, centred, never past the zoom cap. On a
 *  covered card (`visible` canvas px left of `height`) the top padding follows the cover, so the vehicle
 *  shrinks into the visible strip as a building's body does. */
export function vehicleFit(
  bounds: FigureBounds,
  width: number,
  height: number,
  visible: number,
  pixelScale: number,
): FigureFit {
  const covered = Math.max(0, height - visible);
  const top = Math.min(
    Math.max(VEHICLE_PAD_TOP * pixelScale, covered - VEHICLE_COVER_CLEARANCE * pixelScale),
    VEHICLE_PAD_TOP_MAX * pixelScale,
  );
  const left = VEHICLE_PAD_SIDE * pixelScale;
  const right = width - VEHICLE_PAD_SIDE * pixelScale;
  const bottom = height - VEHICLE_PAD_BOTTOM * pixelScale;
  const boundsW = Math.max(1, bounds.maxX - bounds.minX);
  const boundsH = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.min((right - left) / boundsW, (bottom - top) / boundsH, VEHICLE_MAX_ZOOM * pixelScale);
  return {
    zoom,
    feetX: (left + right) / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    feetY: (top + bottom) / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
  };
}
