import type { MinimapMarkerSize } from './filters.js';
import { stampDot } from './model.js';
import { MARKER_RIM_COLOUR } from './palette.js';

/** The marker shapes the dot raster stamps, one per kind of plotted thing. */
export type MinimapMark =
  | 'civilian'
  | 'soldier'
  | 'building'
  | 'vehicle'
  | 'animal'
  | 'road'
  | 'roadSite'
  | 'signpost';

/** The retained RGBA dot buffer, `width × height` raster px, row-major, 4 bytes per px. */
export interface DotRaster {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Marker extents in minimap screen px, so a marker keeps its size through zoom and UI scale. Authored. */
const CIVILIAN_HALF = 1;
const BUILDING_HALF = 1.5;
const SOLDIER_RADIUS = 1.5;
const VEHICLE_HALF = 1;
const ANIMAL_HALF = 0.6;
const ROAD_HALF = 0.75;
const SIGNPOST_HALF_W = 0.5;
const SIGNPOST_HALF_H = 1.25;
/** The marker size choice as a factor on the authored extents. Approximations. */
export const MARKER_SIZE_SCALES: Readonly<Record<MinimapMarkerSize, number>> = {
  small: 0.75,
  medium: 1,
  large: 1.4,
};
/** The outline around every owned marker, in minimap screen px. It does not grow with the marker size:
 *  it only has to part the fill from the ground. Authored. */
const RIM = 1;
/** Widening a diamond's L1 radius by `d` thickens its slanted edges by `d / sqrt 2` only. */
const DIAMOND_RIM_REACH = Math.SQRT2;

/** Owned markers sit in a dark rim, which the light minimap fills stand out against; a vehicle's pale rim
 *  sets it apart from a settler of the same colour. */
const VEHICLE_RIM_COLOUR = 0xf4ead0;

/** No stamp shrinks below one raster px across, or a zoomed-in marker would vanish between pixels. */
const MIN_HALF_PX = 0.6;
/** A diamond whose radius reaches the nearest pixel centre from any point: half a px on each axis. */
const MIN_DIAMOND_RADIUS_PX = 1;
/** A rim keeps at least one raster px on each side. */
const MIN_RIM_PX = 1;

/** Which part of a mark a stamp paints: `rims` under every fill of a replot, then `fills`, so a crowd's
 *  rims never cut into its neighbours' fills; `both` paints one mark whole. */
export type MinimapStampPart = 'both' | 'rims' | 'fills';

/**
 * Stamp `mark` centred on raster px `(cx, cy)`. `pxPerMinimapPx` converts the marker's authored minimap
 * size to raster px at the current zoom and UI scale; `markerScale` is the player's marker size choice,
 * applied to the body and not the rim.
 */
export function stampMark(
  raster: DotRaster,
  cx: number,
  cy: number,
  mark: MinimapMark,
  colour: number,
  pxPerMinimapPx: number,
  markerScale = 1,
  part: MinimapStampPart = 'both',
): void {
  const rims = part !== 'fills';
  const fills = part !== 'rims';
  const rim = Math.max(MIN_RIM_PX, RIM * pxPerMinimapPx);
  switch (mark) {
    case 'civilian':
      stampRimmedSquare(
        raster,
        cx,
        cy,
        CIVILIAN_HALF,
        MARKER_RIM_COLOUR,
        colour,
        pxPerMinimapPx,
        markerScale,
        rim,
        part,
      );
      return;
    case 'building':
      stampRimmedSquare(
        raster,
        cx,
        cy,
        BUILDING_HALF,
        MARKER_RIM_COLOUR,
        colour,
        pxPerMinimapPx,
        markerScale,
        rim,
        part,
      );
      return;
    case 'vehicle':
      stampRimmedSquare(
        raster,
        cx,
        cy,
        VEHICLE_HALF,
        VEHICLE_RIM_COLOUR,
        colour,
        pxPerMinimapPx,
        markerScale,
        rim,
        part,
      );
      return;
    case 'roadSite':
      stampRimmedSquare(
        raster,
        cx,
        cy,
        ROAD_HALF,
        MARKER_RIM_COLOUR,
        colour,
        pxPerMinimapPx,
        markerScale,
        rim,
        part,
      );
      return;
    case 'animal':
      if (fills) stampSquare(raster, cx, cy, sizePx(ANIMAL_HALF, markerScale, pxPerMinimapPx), colour);
      return;
    case 'road':
      if (fills) stampSquare(raster, cx, cy, sizePx(ROAD_HALF, markerScale, pxPerMinimapPx), colour);
      return;
    case 'soldier': {
      const radius = Math.max(MIN_DIAMOND_RADIUS_PX, SOLDIER_RADIUS * markerScale * pxPerMinimapPx);
      if (rims) stampDiamond(raster, cx, cy, radius + rim * DIAMOND_RIM_REACH, MARKER_RIM_COLOUR);
      if (fills) stampDiamond(raster, cx, cy, radius, colour);
      return;
    }
    case 'signpost': {
      const halfW = sizePx(SIGNPOST_HALF_W, markerScale, pxPerMinimapPx);
      const halfH = sizePx(SIGNPOST_HALF_H, markerScale, pxPerMinimapPx);
      if (rims) stampRect(raster, cx, cy, halfW + rim, halfH + rim, MARKER_RIM_COLOUR);
      if (fills) stampRect(raster, cx, cy, halfW, halfH, colour);
      return;
    }
  }
}

/** An authored minimap extent in raster px. Plain functions rather than closures over the call, since a
 *  replot stamps every marker. */
function sizePx(minimapPx: number, markerScale: number, pxPerMinimapPx: number): number {
  return Math.max(MIN_HALF_PX, minimapPx * markerScale * pxPerMinimapPx);
}

function stampSquare(raster: DotRaster, cx: number, cy: number, half: number, colour: number): void {
  stampDot(raster.rgba, raster.width, raster.height, cx, cy, half, colour);
}

/** A square of authored half extent `minimapHalf` in a `rim` of `rimColour`, as much of it as `part` asks. */
function stampRimmedSquare(
  raster: DotRaster,
  cx: number,
  cy: number,
  minimapHalf: number,
  rimColour: number,
  colour: number,
  pxPerMinimapPx: number,
  markerScale: number,
  rim: number,
  part: MinimapStampPart,
): void {
  const half = sizePx(minimapHalf, markerScale, pxPerMinimapPx);
  if (part !== 'fills') stampSquare(raster, cx, cy, half + rim, rimColour);
  if (part !== 'rims') stampSquare(raster, cx, cy, half, colour);
}

function writePixel(raster: DotRaster, x: number, y: number, colour: number): void {
  const o = (y * raster.width + x) * 4;
  raster.rgba[o] = (colour >> 16) & 0xff;
  raster.rgba[o + 1] = (colour >> 8) & 0xff;
  raster.rgba[o + 2] = colour & 0xff;
  raster.rgba[o + 3] = 0xff;
}

/** Every px whose centre lies within L1 distance `radius` of `(cx, cy)`, clipped to the buffer. */
function stampDiamond(raster: DotRaster, cx: number, cy: number, radius: number, colour: number): void {
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(raster.height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const reach = radius - Math.abs(y + 0.5 - cy);
    if (reach < 0) continue;
    const x0 = Math.max(0, Math.ceil(cx - reach - 0.5));
    const x1 = Math.min(raster.width - 1, Math.floor(cx + reach - 0.5));
    for (let x = x0; x <= x1; x++) writePixel(raster, x, y, colour);
  }
}

/** {@link stampDot} with separate half extents. */
function stampRect(
  raster: DotRaster,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  colour: number,
): void {
  const x0 = Math.max(0, Math.round(cx - halfW));
  const y0 = Math.max(0, Math.round(cy - halfH));
  const x1 = Math.min(raster.width, Math.round(cx + halfW));
  const y1 = Math.min(raster.height, Math.round(cy + halfH));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) writePixel(raster, x, y, colour);
  }
}
