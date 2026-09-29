import { buildWeatherField, type WeatherField } from '@open-northland/render';
import { WEATHER_DENSITY_FULL, WEATHER_KINDS, type WeatherRegionInput } from '@open-northland/render/data';
import type { WeatherParam } from './params.js';

/** Mirrors the sim's weather regions into the renderer's sector field. */
export interface WeatherFeed {
  write(region: WeatherRegionInput): void;
}

const regionKey = (r: WeatherRegionInput): string =>
  `${r.weather}:${r.min.hx},${r.min.hy}:${r.max.hx},${r.max.hy}`;
const PERCENT_FULL = 100;

/** The view-only `?weather=` override as whole-map regions: `clear` zeroes every kind. */
function overrideRegions(param: WeatherParam, nodesX: number, nodesY: number): WeatherRegionInput[] {
  const whole = { min: { hx: 0, hy: 0 }, max: { hx: nodesX - 1, hy: nodesY - 1 } };
  const density = (param.percent / PERCENT_FULL) * WEATHER_DENSITY_FULL;
  return WEATHER_KINDS.map((weather) => ({
    weather,
    ...whole,
    density: weather === param.kind ? density : 0,
  }));
}

/**
 * Keeps the sim's write order: a repeated kind and extent moves to the end, zero clears included, and
 * every write rebuilds the field. Writes are rare (map load, script results), so the rebuild is cheap.
 * An override lies over every write.
 */
export function createWeatherFeed(
  map: { readonly width: number; readonly height: number },
  apply: (field: WeatherField) => void,
  override: WeatherParam | null = null,
): WeatherFeed {
  const regions = new Map<string, WeatherRegionInput>();
  // Cells to half-cell nodes: the lattice is twice the map in each axis.
  const nodesX = map.width * 2;
  const nodesY = map.height * 2;
  const over = override === null ? [] : overrideRegions(override, nodesX, nodesY);
  const rebuild = (): void => apply(buildWeatherField([...regions.values(), ...over], nodesX, nodesY));
  if (over.length > 0) rebuild();
  return {
    write(region) {
      const key = regionKey(region);
      regions.delete(key);
      regions.set(key, region);
      rebuild();
    },
  };
}
