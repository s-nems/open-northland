import { WEATHER_DENSITY_FULL, WEATHER_KINDS, type WeatherKind, type WeatherRegionInput } from './types.js';

/**
 * Original behaviour: weather lives on a grid of sectors 10 half-cell nodes square. A written rectangle
 * overwrites every sector it covers, and a lookup blends the four sectors around the point bilinearly
 * between sector centres.
 */
export const WEATHER_SECTOR_NODES = 10;
const SECTOR_CENTRE_NODES = WEATHER_SECTOR_NODES / 2;
const KIND_COUNT = WEATHER_KINDS.length;

/** Per-sector amounts 0..1, kind-interleaved (`[rain, snow, sand]` per sector), row-major. */
export interface WeatherField {
  readonly sectorsX: number;
  readonly sectorsY: number;
  readonly amounts: Float32Array;
  /** True when any sector has any weather; lets consumers skip all work on a dry map. */
  readonly any: boolean;
  /** 0..1 snow the ground keeps whatever falls: a winter game's lying snow. Absent is none. */
  readonly lyingSnow?: number;
}

const kindIndex = (kind: WeatherKind): number => WEATHER_KINDS.indexOf(kind);

function sectorOf(node: number, sectors: number): number {
  return Math.min(sectors - 1, Math.max(0, Math.trunc((node - SECTOR_CENTRE_NODES) / WEATHER_SECTOR_NODES)));
}

/** Replays the regions in write order onto a sector grid for a map `nodesX` by `nodesY` half-cell nodes. */
export function buildWeatherField(
  regions: readonly WeatherRegionInput[],
  nodesX: number,
  nodesY: number,
): WeatherField {
  const sectorsX = Math.max(1, Math.ceil(nodesX / WEATHER_SECTOR_NODES));
  const sectorsY = Math.max(1, Math.ceil(nodesY / WEATHER_SECTOR_NODES));
  const amounts = new Float32Array(sectorsX * sectorsY * KIND_COUNT);
  for (const region of regions) {
    const k = kindIndex(region.weather);
    const amount = Math.min(1, Math.max(0, region.density / WEATHER_DENSITY_FULL));
    const x0 = sectorOf(region.min.hx, sectorsX);
    const x1 = sectorOf(region.max.hx, sectorsX);
    const y0 = sectorOf(region.min.hy, sectorsY);
    const y1 = sectorOf(region.max.hy, sectorsY);
    for (let sy = y0; sy <= y1; sy++) {
      for (let sx = x0; sx <= x1; sx++) amounts[(sy * sectorsX + sx) * KIND_COUNT + k] = amount;
    }
  }
  return { sectorsX, sectorsY, amounts, any: amounts.some((amount) => amount > 0) };
}

/** The bilinear amount 0..1 of `kind` at a fractional half-cell node position. */
export function weatherAmountAt(field: WeatherField, kind: WeatherKind, hx: number, hy: number): number {
  const k = kindIndex(kind);
  const fx = Math.min(field.sectorsX - 1, Math.max(0, (hx - SECTOR_CENTRE_NODES) / WEATHER_SECTOR_NODES));
  const fy = Math.min(field.sectorsY - 1, Math.max(0, (hy - SECTOR_CENTRE_NODES) / WEATHER_SECTOR_NODES));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(field.sectorsX - 1, x0 + 1);
  const y1 = Math.min(field.sectorsY - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (sx: number, sy: number): number =>
    field.amounts[(sy * field.sectorsX + sx) * KIND_COUNT + k] ?? 0;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * RGBA8 texels, one per sector (r rain, g snow, b sand), for a GPU consumer that samples with linear
 * filtering: texel centres sit on sector centres, so hardware filtering reproduces the bilinear lookup.
 */
export function weatherFieldTexels(field: WeatherField): Uint8Array {
  const sectors = field.sectorsX * field.sectorsY;
  const texels = new Uint8Array(sectors * 4);
  const BYTE_MAX = 255;
  for (let i = 0; i < sectors; i++) {
    for (let k = 0; k < KIND_COUNT; k++) {
      texels[i * 4 + k] = Math.round((field.amounts[i * KIND_COUNT + k] ?? 0) * BYTE_MAX);
    }
    texels[i * 4 + 3] = BYTE_MAX;
  }
  return texels;
}
