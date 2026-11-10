import { MAP_PING_MS, type WorldBounds } from '@open-northland/render';
import type { HalfCellNode } from '@open-northland/sim';
import { type Container, Graphics } from 'pixi.js';
import type { Rect } from '../geometry.js';
import { alarmPoint, ringCentre } from './alarms.js';
import { MARKER_RIM_COLOUR } from './palette.js';

/**
 * A map ping on the minimap, in the pinging player's colour: a pin headed by a round gilt-rimmed shield
 * drops onto the spot and marks it until the ping fades, while rings run out from it, the opposite of
 * the attack alarm's rings that close in. The rings draw outside the minimap's clip, so the first wave
 * reaches over the frame; past a zoomed map's edge they ripple from the nearest edge point. Every stroke
 * wears a dark rim so it reads over markers of its own colour. Extents in minimap screen px; authored.
 */

/** The share of the ping's life over which everything fades out at the end. */
const FADE_SHARE = 0.2;

/** Two waves of two rings; the first reaches further, to pull the eye. */
const WAVE_STARTS_MS = [0, 1600];
const WAVE_END_RADII = [40, 24];
const RINGS_PER_WAVE = 2;
const RING_STAGGER_MS = 240;
const RING_MS = 1000;
const RING_START_RADIUS = 2;
const RING_START_WIDTH = 2.6;
const RING_END_WIDTH = 1;
const RIM = 1;
const RIM_ALPHA = 0.7;

const PIN_DROP_MS = 200;
/** The pin: how high its shield's centre stands over the spot, how far it falls onto it, the shield's
 *  radius, its gilt rim and boss, and the half-width of the point under it. */
const PIN_HEIGHT = 11;
const DROP_HEIGHT = 9;
const SHIELD_RADIUS = 4.6;
const GILT_WIDTH = 1.3;
const BOSS_RADIUS = 1.8;
const POINT_HALF_WIDTH = 2.4;
const GILT = 0xe2b340;

interface SignalRing {
  readonly radius: number;
  readonly width: number;
  readonly alpha: number;
}

/** One ping's look at a moment, in minimap screen px. */
interface SignalFrame {
  readonly alpha: number;
  readonly rings: readonly SignalRing[];
  /** How high over the spot the falling pin's point is. */
  readonly pinLift: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInQuad = (t: number): number => t * t;
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** The ping `elapsed` ms after it was raised, or null once it has gone. */
function signalFrame(elapsed: number): SignalFrame | null {
  if (elapsed < 0 || elapsed >= MAP_PING_MS) return null;
  const alpha = clamp01((1 - elapsed / MAP_PING_MS) / FADE_SHARE);
  const rings: SignalRing[] = [];
  WAVE_STARTS_MS.forEach((waveStart, wave) => {
    const endRadius = WAVE_END_RADII[wave] ?? RING_START_RADIUS;
    for (let k = 0; k < RINGS_PER_WAVE; k++) {
      const local = (elapsed - waveStart - k * RING_STAGGER_MS) / RING_MS;
      if (local < 0 || local > 1) continue;
      rings.push({
        radius: lerp(RING_START_RADIUS, endRadius, easeOutCubic(local)),
        width: lerp(RING_START_WIDTH, RING_END_WIDTH, local),
        alpha: (1 - local) * alpha,
      });
    }
  });
  return {
    alpha,
    rings,
    pinLift: DROP_HEIGHT * (1 - easeInQuad(clamp01(elapsed / PIN_DROP_MS))),
  };
}

export interface SignalLayer {
  /** Show a ping at half-cell node `at` in `colour`, starting at `now` ms. */
  add(at: HalfCellNode, colour: number, now: number): void;
  /** Redraw the showing pings; costs nothing once the last one has gone. `pxPerMinimapPx` converts
   *  minimap screen px to the containers' raster px; `visible` is the shown part of the raster. */
  draw(now: number, pxPerMinimapPx: number, visible: Rect): void;
}

interface Signal {
  readonly x: number;
  readonly y: number;
  readonly colour: number;
  readonly start: number;
}

/**
 * The pings over the minimap's markers, in the dot raster's px: `clipped` holds the pin inside
 * the minimap's clip, `unclipped` shares its transform without the clip and holds the
 * rings. Parented on creation, so the caller creates it above the dots in draw order.
 */
export function createSignalLayer(
  clipped: Container,
  unclipped: Container,
  bounds: WorldBounds,
  rasterScale: number,
): SignalLayer {
  const pins = new Graphics();
  const rings = new Graphics();
  clipped.addChild(pins);
  unclipped.addChild(rings);
  let signals: Signal[] = [];
  let drawn = false;
  return {
    add: (at, colour, now) => {
      signals.push({ ...alarmPoint(at, bounds, rasterScale), colour, start: now });
    },
    draw: (now, px, visible) => {
      if (signals.length === 0 && !drawn) return;
      pins.clear();
      rings.clear();
      const showing: Signal[] = [];
      for (const signal of signals) {
        const frame = signalFrame(now - signal.start);
        if (frame === null) continue;
        showing.push(signal);
        const { x, y, colour } = signal;
        const centre = ringCentre(signal, visible);
        for (const ring of frame.rings) {
          rings
            .circle(centre.x, centre.y, ring.radius * px)
            .stroke({
              width: (ring.width + 2 * RIM) * px,
              color: MARKER_RIM_COLOUR,
              alpha: RIM_ALPHA * ring.alpha,
            })
            .circle(centre.x, centre.y, ring.radius * px)
            .stroke({ width: ring.width * px, color: colour, alpha: ring.alpha });
        }
        const a = frame.alpha;
        const point = y - frame.pinLift * px;
        const shield = point - PIN_HEIGHT * px;
        pins
          .poly([x - POINT_HALF_WIDTH * px, shield, x + POINT_HALF_WIDTH * px, shield, x, point])
          .fill({ color: GILT, alpha: a })
          .stroke({ width: RIM * px, color: MARKER_RIM_COLOUR, alpha: a, join: 'round' })
          .circle(x, shield, (SHIELD_RADIUS + GILT_WIDTH + RIM) * px)
          .fill({ color: MARKER_RIM_COLOUR, alpha: a })
          .circle(x, shield, (SHIELD_RADIUS + GILT_WIDTH) * px)
          .fill({ color: GILT, alpha: a })
          .circle(x, shield, SHIELD_RADIUS * px)
          .fill({ color: colour, alpha: a })
          .circle(x, shield, BOSS_RADIUS * px)
          .fill({ color: GILT, alpha: a });
      }
      signals = showing;
      drawn = showing.length > 0;
    },
  };
}
