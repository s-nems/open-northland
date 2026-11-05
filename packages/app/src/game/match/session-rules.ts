import { isMultiplayerMapType } from '@open-northland/data';
import {
  DAY_NIGHT_MODES,
  type DayNightMode,
  PEACE_MINUTES,
  type PeaceMinutes,
  type SessionRules,
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

/** The `?fog=`, `?progression=`, `?needs=`, `?weathermode=`, `?daynight=`, `?alliedvision=` and `?peace=` flags as the
 *  session's rule overrides. */
export function sessionRuleOverrides(params: URLSearchParams): SessionRules {
  return {
    fog: fogModeParam(params),
    progression: onOffParam(params, 'progression'),
    needs: onOffParam(params, 'needs'),
    weather: weatherModeParam(params),
    dayNight: dayNightModeParam(params),
    alliedVision: onOffParam(params, 'alliedvision'),
    peace: peaceParam(params),
  };
}

/** The rules the sim applies; weather and day and night are presentation only. */
export type SimSessionRules = Omit<SessionRules, 'weather' | 'dayNight'>;

/**
 * Apply the overrides to a freshly built sim. The queue is FIFO and these land after the world's own
 * rules, so a flag wins in either direction; an absent flag enqueues nothing, keeping the command
 * stream byte-identical. The peace needs the seats it binds, so the map world opens it.
 */
export function applySessionRuleOverrides(sim: WorldSetup, overrides: Omit<SimSessionRules, 'peace'>): void {
  if (overrides.fog !== null) sim.enqueueSetup({ kind: 'setFogMode', mode: overrides.fog });
  if (overrides.progression !== null) {
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: overrides.progression });
  }
  if (overrides.needs !== null) sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: overrides.needs });
  if (overrides.alliedVision !== null) {
    sim.enqueueSetup({ kind: 'setAlliedVision', enabled: overrides.alliedVision });
  }
}

/** The allied-vision rule a local game starts a map with: on for a multiplayer map, off for a
 *  single-player one. A network room always starts with it on. */
export function localAlliedVision(mapTypes: readonly number[]): boolean {
  return isMultiplayerMapType(mapTypes);
}
