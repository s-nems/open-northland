import type { Camera, ElevationField } from '@open-northland/render';
import type { HalfCellNode, SimEvent } from '@open-northland/sim';
import { type Container, Graphics } from 'pixi.js';
import { screenToWorld, worldToTile } from './picking.js';

/**
 * The screen-wide reactions to a map script's weather and earthquake results. Approximations both:
 * the original rains, snows and shakes the map itself; this build washes the view in the weather's
 * colour by the density at the view's centre, and jitters the camera for the quake's duration.
 */

/** The density a script or map writes runs 0 to 10000 (reading); the wash tops out at this alpha. */
const DENSITY_FULL = 10000;
const WASH_MAX_ALPHA = 0.35;
const WASH_COLOR: Readonly<Record<'rain' | 'snow', number>> = { rain: 0x2b3f5e, snow: 0xe8eef5 };
/** Quake amplitude (screen px) and the two incommensurate rates (rad/ms) that keep it from looping. */
const QUAKE_AMPLITUDE_PX = 6;
const QUAKE_RATE_X = 0.05;
const QUAKE_RATE_Y = 0.037;
const MS_PER_SECOND = 1000;

type WeatherEvent = Extract<SimEvent, { kind: 'missionWeather' }>;

export interface CameraJitter {
  readonly dx: number;
  readonly dy: number;
}

export interface ScriptEffects {
  setWeather(event: WeatherEvent): void;
  startEarthquake(seconds: number, nowMs: number): void;
  /** The quake's current camera offset, or null while the ground is still. */
  jitter(nowMs: number): CameraJitter | null;
  /** Per-frame: redraw the wash for the weather at the view's centre. */
  update(camera: Camera, screen: { readonly width: number; readonly height: number }): void;
  dispose(): void;
}

/** One square per weather and extent: a later write over the same square replaces it, the way a
 *  later write overwrites a sector's field in the original, and a zero takes it out. */
const squareKey = (s: WeatherEvent): string => `${s.weather}:${s.min.hx},${s.min.hy}:${s.max.hx},${s.max.hy}`;

/** The density of `weather` at `node`: the last square written over it decides. */
function densityAt(
  squares: Iterable<WeatherEvent>,
  weather: WeatherEvent['weather'],
  node: HalfCellNode,
): number {
  let density = 0;
  for (const s of squares) {
    if (s.weather !== weather) continue;
    if (node.hx < s.min.hx || node.hx > s.max.hx || node.hy < s.min.hy || node.hy > s.max.hy) continue;
    density = s.density;
  }
  return density;
}

export function createScriptEffects(parent: Container, elevation?: ElevationField): ScriptEffects {
  const wash = new Graphics();
  parent.addChild(wash);
  /** Insertion order is write order, which is what decides an overlap. */
  const squares = new Map<string, WeatherEvent>();
  let quakeUntilMs = 0;
  let drawnKey = '';

  return {
    setWeather(event) {
      const key = squareKey(event);
      squares.delete(key);
      if (event.density > 0) squares.set(key, event);
    },
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
    update(camera, screen) {
      const centre = screenToWorld(camera, screen.width / 2, screen.height / 2);
      const tile = worldToTile(centre.x, centre.y, elevation);
      const node = { hx: tile.col, hy: tile.row };
      const rain = densityAt(squares.values(), 'rain', node);
      const snow = densityAt(squares.values(), 'snow', node);
      const weather = snow > rain ? 'snow' : 'rain';
      const density = Math.max(rain, snow);
      const key = `${weather}:${density}:${screen.width}x${screen.height}`;
      if (key === drawnKey) return;
      drawnKey = key;
      wash.clear();
      if (density <= 0) return;
      const alpha = (Math.min(DENSITY_FULL, density) / DENSITY_FULL) * WASH_MAX_ALPHA;
      wash.rect(0, 0, screen.width, screen.height).fill({ color: WASH_COLOR[weather], alpha });
    },
    dispose() {
      wash.destroy();
    },
  };
}
