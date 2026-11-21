import { RESOURCE_YIELD_GOODS } from '@open-northland/data';
import {
  DAY_NIGHT_MODES,
  type DayNightMode,
  PEACE_MINUTES,
  type PeaceMinutes,
  RESOURCE_YIELD_FACTORS,
  type ResourceYieldFactor,
  type SessionRules,
  STORAGE_CAPACITY_FACTORS,
  type StorageCapacityFactor,
  WEATHER_MODES,
  type WeatherMode,
} from '@open-northland/lockstep';
import { fogModeParam } from '../fog.js';
import type { WorldSetup } from '../world/index.js';

/** Parse an `on`/`off` rule URL flag; null for absent or unrecognized, which keeps the world's rule. */
export function onOffParam(params: URLSearchParams, name: string): boolean | null {
  const value = params.get(name);
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

/** `?weathermode=<map|variable|winter|off>`; null for absent or unrecognized, which plays the default. */
export function weatherModeParam(params: URLSearchParams): WeatherMode | null {
  const value = params.get('weathermode');
  return WEATHER_MODES.find((mode) => mode === value) ?? null;
}

/** `?daynight=<map|on|off>`; null for absent or unrecognized, which plays the default. */
export function dayNightModeParam(params: URLSearchParams): DayNightMode | null {
  const value = params.get('daynight');
  return DAY_NIGHT_MODES.find((mode) => mode === value) ?? null;
}

/** `?peace=<minutes>`, one of `PEACE_MINUTES`; null for absent or unrecognized, which opens no peace. */
export function peaceParam(params: URLSearchParams): PeaceMinutes | null {
  const value = params.get('peace');
  return PEACE_MINUTES.find((minutes) => String(minutes) === value) ?? null;
}

/** `?storage=<factor>`, one of `STORAGE_CAPACITY_FACTORS`; null for absent or unrecognized, which keeps the
 *  content's storage sizes. */
export function storageCapacityParam(params: URLSearchParams): StorageCapacityFactor | null {
  const value = params.get('storage');
  return STORAGE_CAPACITY_FACTORS.find((factor) => String(factor) === value) ?? null;
}

export type ResourceYieldRule = 'basicYield' | 'oreYield';

/** The launch param that carries each resource richness rule. */
export const RESOURCE_YIELD_PARAMS: Readonly<Record<ResourceYieldRule, string>> = {
  basicYield: 'basicyield',
  oreYield: 'oreyield',
};

/** `?basicyield=` and `?oreyield=`, one of `RESOURCE_YIELD_FACTORS` each; null for absent or unrecognized,
 *  which keeps the authored stock. */
export function resourceYieldParam(
  params: URLSearchParams,
  rule: ResourceYieldRule,
): ResourceYieldFactor | null {
  const value = params.get(RESOURCE_YIELD_PARAMS[rule]);
  return RESOURCE_YIELD_FACTORS.find((factor) => String(factor) === value) ?? null;
}

/** A variant's ore richness as a session factor; throws on a value the session cannot carry. */
export function resourceYieldFactor(value: number): ResourceYieldFactor {
  const factor = RESOURCE_YIELD_FACTORS.find((known) => known === value);
  if (factor === undefined) throw new Error(`${value} is not a resource yield factor`);
  return factor;
}

/** The factor each map-placed good's stock starts at under `rules`, by content good id; a good left out
 *  keeps its authored stock. */
export function depositYieldOf(
  rules: Pick<SessionRules, 'basicYield' | 'oreYield'>,
): Readonly<Record<string, number>> {
  const groups = [
    [RESOURCE_YIELD_GOODS.basic, rules.basicYield],
    [RESOURCE_YIELD_GOODS.ore, rules.oreYield],
  ] as const;
  return Object.fromEntries(
    groups.flatMap(([goods, factor]) => (factor === null ? [] : goods.map((good) => [good, factor]))),
  );
}

/** The `?fog=`, `?progression=`, `?needs=`, `?weathermode=`, `?daynight=`, `?alliedvision=`, `?peace=`,
 *  `?storage=`, `?basicyield=`, `?oreyield=` and `?papers=` flags as the session's rule overrides. */
export function sessionRuleOverrides(params: URLSearchParams): SessionRules {
  return {
    fog: fogModeParam(params),
    progression: onOffParam(params, 'progression'),
    needs: onOffParam(params, 'needs'),
    weather: weatherModeParam(params),
    dayNight: dayNightModeParam(params),
    alliedVision: onOffParam(params, 'alliedvision'),
    peace: peaceParam(params),
    storageCapacity: storageCapacityParam(params),
    basicYield: resourceYieldParam(params, 'basicYield'),
    oreYield: resourceYieldParam(params, 'oreYield'),
    papers: onOffParam(params, 'papers'),
  };
}

/** The rules the world applies; weather and day and night are presentation only. */
export type SimSessionRules = Omit<SessionRules, 'weather' | 'dayNight'>;

/**
 * Apply the overrides to a freshly built sim. The queue is FIFO and these land after the world's own
 * rules, so a flag wins in either direction; an absent flag enqueues nothing, keeping the command
 * stream byte-identical. The peace needs the seats it binds and a paper ban the starting papers it
 * keeps the headquarters paper of, so the map world sets both.
 */
export function applySessionRuleOverrides(
  sim: WorldSetup,
  overrides: Omit<SimSessionRules, 'peace' | 'basicYield' | 'oreYield' | 'papers'>,
): void {
  if (overrides.fog !== null) sim.enqueueSetup({ kind: 'setFogMode', mode: overrides.fog });
  if (overrides.progression !== null) {
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: overrides.progression });
  }
  if (overrides.needs !== null) sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: overrides.needs });
  if (overrides.alliedVision !== null) {
    sim.enqueueSetup({ kind: 'setAlliedVision', enabled: overrides.alliedVision });
  }
  if (overrides.storageCapacity !== null) {
    sim.enqueueSetup({ kind: 'setStorageCapacity', factor: overrides.storageCapacity });
  }
}
