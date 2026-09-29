import { buildWeatherField, type WeatherField } from '@open-northland/render';
import {
  ambientStrength,
  buildAmbientField,
  WEATHER_DENSITY_FULL,
  WEATHER_KINDS,
  type WeatherRegionInput,
} from '@open-northland/render/data';
import type { AmbientWeather } from './ambient-weather.js';
import type { WeatherParam } from './params.js';

/** Mirrors the sim's weather regions into the renderer's sector field. */
export interface WeatherFeed {
  write(region: WeatherRegionInput): void;
  /** Several writes in order with one rebuild, for restoring a saved or seeded list. */
  writeAll(regions: readonly WeatherRegionInput[]): void;
  /** Once per frame: moves the ambient weather along the game clock. */
  frame(gameSeconds: number): void;
}

/** Ambient strength moves the field in this many steps; the renderer fades between them. */
const AMBIENT_STRENGTH_STEPS = 32;

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
 * An override lies over every write. Scheduled ambient weather plays only until the first write and
 * never under an override.
 */
export function createWeatherFeed(
  map: { readonly width: number; readonly height: number },
  apply: (field: WeatherField) => void,
  override: WeatherParam | null = null,
  ambient: AmbientWeather | null = null,
): WeatherFeed {
  const regions = new Map<string, WeatherRegionInput>();
  // Cells to half-cell nodes: the lattice is twice the map in each axis.
  const nodesX = map.width * 2;
  const nodesY = map.height * 2;
  const held = override?.kind === 'ambient' ? override : null;
  const over = override === null || held !== null ? [] : overrideRegions(override, nodesX, nodesY);
  const heldField =
    held === null || ambient === null
      ? null
      : buildAmbientField(ambient.sectors, held.percent / PERCENT_FULL);
  const rebuild = (): void =>
    apply(heldField ?? buildWeatherField([...regions.values(), ...over], nodesX, nodesY));
  if (over.length > 0 || heldField !== null) rebuild();
  let ambientLive = ambient?.scheduled === true && override === null;
  let ambientStep = 0;
  const retain = (region: WeatherRegionInput): void => {
    ambientLive = false;
    const key = regionKey(region);
    regions.delete(key);
    regions.set(key, region);
  };
  return {
    write(region) {
      retain(region);
      rebuild();
    },
    writeAll(list) {
      if (list.length === 0) return;
      for (const region of list) retain(region);
      rebuild();
    },
    frame(gameSeconds) {
      if (!ambientLive || ambient === null) return;
      const step = Math.round(ambientStrength(ambient.seed, gameSeconds) * AMBIENT_STRENGTH_STEPS);
      if (step === ambientStep) return;
      ambientStep = step;
      apply(buildAmbientField(ambient.sectors, step / AMBIENT_STRENGTH_STEPS));
    },
  };
}
