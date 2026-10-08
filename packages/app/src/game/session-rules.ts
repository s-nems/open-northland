import { isMultiplayerMapType } from '@open-northland/data';
import { type SessionRules, WEATHER_MODES, type WeatherMode } from '@open-northland/lockstep';
import { fogModeParam } from './fog.js';
import type { WorldSetup } from './world/index.js';

/** Parse an `on`/`off` rule URL flag; null for absent or unrecognized, which keeps the world's rule. */
export function onOffParam(params: URLSearchParams, name: string): boolean | null {
  const value = params.get(name);
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

/** `?weathermode=<map|variable|winter>`; null for absent or unrecognized, which plays the default. */
export function weatherModeParam(params: URLSearchParams): WeatherMode | null {
  const value = params.get('weathermode');
  return WEATHER_MODES.find((mode) => mode === value) ?? null;
}

/** The `?fog=`, `?progression=`, `?needs=`, `?weathermode=` and `?alliedvision=` flags as the session's
 *  rule overrides. */
export function sessionRuleOverrides(params: URLSearchParams): SessionRules {
  return {
    fog: fogModeParam(params),
    progression: onOffParam(params, 'progression'),
    needs: onOffParam(params, 'needs'),
    weather: weatherModeParam(params),
    alliedVision: onOffParam(params, 'alliedvision'),
  };
}

/** The rules the sim applies; weather is presentation only. */
export type SimSessionRules = Omit<SessionRules, 'weather'>;

/**
 * Apply the overrides to a freshly built sim. The queue is FIFO and these land after the world's own
 * rules, so a flag wins in either direction; an absent flag enqueues nothing, keeping the command
 * stream byte-identical.
 */
export function applySessionRuleOverrides(sim: WorldSetup, overrides: SimSessionRules): void {
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
