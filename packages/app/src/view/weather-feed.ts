import { buildWeatherField, type WeatherField } from '@open-northland/render';
import {
  type AmbientWeatherNow,
  buildAmbientField,
  variableWeather,
  WEATHER_DENSITY_FULL,
  WEATHER_KINDS,
  type WeatherRegionInput,
  winterWeather,
} from '@open-northland/render/data';
import type { AmbientWeather } from './ambient-weather.js';
import { PERCENT_FULL, type WeatherParam } from './params.js';

/** Mirrors the sim's weather regions into the renderer's sector field. */
export interface WeatherFeed {
  write(region: WeatherRegionInput): void;
  /** Several writes in order with one rebuild, for restoring a saved or seeded list. */
  writeAll(regions: readonly WeatherRegionInput[]): void;
  /** Once per frame: moves the game's own weather along the game clock. */
  frame(gameSeconds: number): void;
}

/** The game's own weather moves the field in steps of this share of a level; the renderer fades
 *  between them. */
const AMBIENT_LEVEL_STEP = 1 / 32;

const regionKey = (r: WeatherRegionInput): string =>
  `${r.weather}:${r.min.hx},${r.min.hy}:${r.max.hx},${r.max.hy}`;

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
 * An override lies over every write. The game's own weather fills the sectors the map leaves clear
 * and never plays under an override; a held `ambient` override plays it in every match mode.
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
  const held = override?.kind === 'ambient' && ambient !== null ? override : null;
  const over = override === null || held !== null ? [] : overrideRegions(override, nodesX, nodesY);
  const own = held !== null || (ambient !== null && ambient.mode !== 'map' && override === null);
  const winter = ambient?.mode === 'winter';
  let now: AmbientWeatherNow =
    held === null ? { level: 0, cold: false } : { level: held.percent / PERCENT_FULL, cold: false };

  // A winter game lays its snow on the first frame, whatever falls then.
  let laid = !winter;

  const rebuild = (): void => {
    laid = true;
    const authored = buildWeatherField([...regions.values(), ...over], nodesX, nodesY);
    apply(own && ambient !== null ? buildAmbientField(ambient.sectors, now, winter, authored) : authored);
  };
  if (over.length > 0 || held !== null) rebuild();
  const retain = (region: WeatherRegionInput): void => {
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
      if (!own || ambient === null || held !== null) return;
      const next = (winter ? winterWeather : variableWeather)(ambient.seed, gameSeconds);
      const level = Math.round(next.level / AMBIENT_LEVEL_STEP) * AMBIENT_LEVEL_STEP;
      if (laid && level === now.level && (level === 0 || next.cold === now.cold)) return;
      now = { level, cold: next.cold };
      rebuild();
    },
  };
}
