/**
 * The camera's reaction to a map script's earthquake. Approximation: the original shakes the map
 * itself; this build jitters the drawn camera for the quake's duration.
 */

/** Quake amplitude (screen px) and the two incommensurate rates (rad/ms) that keep it from looping. */
const QUAKE_AMPLITUDE_PX = 6;
const QUAKE_RATE_X = 0.05;
const QUAKE_RATE_Y = 0.037;
const MS_PER_SECOND = 1000;

export interface CameraJitter {
  readonly dx: number;
  readonly dy: number;
}

export interface ScriptEffects {
  startEarthquake(seconds: number, nowMs: number): void;
  /** The quake's current camera offset, or null while the ground is still. */
  jitter(nowMs: number): CameraJitter | null;
}

export function createScriptEffects(): ScriptEffects {
  let quakeUntilMs = 0;
  return {
    startEarthquake(seconds, nowMs) {
      quakeUntilMs = nowMs + seconds * MS_PER_SECOND;
    },
    jitter(nowMs) {
      if (nowMs >= quakeUntilMs) return null;
      return {
        dx: Math.round(QUAKE_AMPLITUDE_PX * Math.sin(nowMs * QUAKE_RATE_X)),
        dy: Math.round(QUAKE_AMPLITUDE_PX * Math.cos(nowMs * QUAKE_RATE_Y)),
      };
    },
  };
}
