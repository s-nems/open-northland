import { stampDot } from './model.js';

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
const SOLDIER_RIM = 0.5;
const VEHICLE_HALF = 1;
const VEHICLE_RIM = 0.6;
const ANIMAL_HALF = 0.6;
const ROAD_HALF = 0.75;
const SIGNPOST_HALF_W = 0.5;
const SIGNPOST_HALF_H = 1.25;

/** A dark rim sets soldiers apart from civilians in the same player colour; a pale rim marks vehicles. */
const SOLDIER_RIM_COLOUR = 0x1a120a;
const VEHICLE_RIM_COLOUR = 0xf4ead0;

/** No stamp shrinks below one raster px across, or a zoomed-in marker would vanish between pixels. */
const MIN_HALF_PX = 0.6;
/** A diamond whose radius reaches the nearest pixel centre from any point: half a px on each axis. */
const MIN_DIAMOND_RADIUS_PX = 1;

/**
 * Stamp `mark` centred on raster px `(cx, cy)`. `pxPerMinimapPx` converts the marker's authored minimap
 * size to raster px at the current zoom and UI scale.
 */
export function stampMark(
  raster: DotRaster,
  cx: number,
  cy: number,
  mark: MinimapMark,
  colour: number,
  pxPerMinimapPx: number,
): void {
  const size = (minimapPx: number): number => Math.max(MIN_HALF_PX, minimapPx * pxPerMinimapPx);
  const square = (half: number, fill: number): void =>
    stampDot(raster.rgba, raster.width, raster.height, cx, cy, size(half), fill);
  switch (mark) {
    case 'civilian':
      square(CIVILIAN_HALF, colour);
      return;
    case 'building':
      square(BUILDING_HALF, colour);
      return;
    case 'animal':
      square(ANIMAL_HALF, colour);
      return;
    case 'road':
    case 'roadSite':
      square(ROAD_HALF, colour);
      return;
    case 'vehicle':
      square(VEHICLE_HALF + VEHICLE_RIM, VEHICLE_RIM_COLOUR);
      square(VEHICLE_HALF, colour);
      return;
    case 'soldier': {
      const radius = Math.max(MIN_DIAMOND_RADIUS_PX, SOLDIER_RADIUS * pxPerMinimapPx);
      stampDiamond(
        raster,
        cx,
        cy,
        radius + Math.max(MIN_HALF_PX, SOLDIER_RIM * pxPerMinimapPx),
        SOLDIER_RIM_COLOUR,
      );
      stampDiamond(raster, cx, cy, radius, colour);
      return;
    }
    case 'signpost':
      stampRect(raster, cx, cy, size(SIGNPOST_HALF_W), size(SIGNPOST_HALF_H), colour);
      return;
  }
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
