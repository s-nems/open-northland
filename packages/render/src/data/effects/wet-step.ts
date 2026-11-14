import { RAIN_SPLASH_RGB } from '../weather/cover.js';

/**
 * The splash a step throws up on rain-wet ground, an Open Northland addition: the original draws weather
 * only in the air. It is the rain's own ground splash drawn larger and slower: a few droplets thrown up
 * at the foot, and rings that go on spreading over the wet ground after the walker has moved on, so a
 * walk in the rain leaves a short trail of fading rings. Every size, life and threshold below is tuned
 * by eye.
 */

/** Ground wetness (0..1) at which a step starts to splash, and from which it splashes at full strength. */
const WET_STEP_ONSET = 0.2;
const WET_STEP_FULL = 0.6;
/** A splash on barely wet ground shows at this share of a soaked one. */
const WET_STEP_ONSET_STRENGTH = 0.5;

/** How strongly a step splashes on ground of `wetness` 0..1; 0 on ground too dry to splash. */
export function wetStepStrength(wetness: number): number {
  if (wetness < WET_STEP_ONSET) return 0;
  const t = Math.min(1, (wetness - WET_STEP_ONSET) / (WET_STEP_FULL - WET_STEP_ONSET));
  return WET_STEP_ONSET_STRENGTH + (1 - WET_STEP_ONSET_STRENGTH) * t;
}

/** Sim ticks a splash lives: a walker is two or three steps on by its end. */
export const WET_STEP_LIFE_TICKS = 20;
/** Frames its life plays through. */
export const WET_STEP_FRAMES = 20;
/** A full-strength splash's opacity; its frames carry the fade. */
export const WET_STEP_ALPHA = 0.7;

/** The frame a splash shows `age` ticks after its step; -1 before it and once it is gone. */
export function wetStepFrame(age: number): number {
  if (age < 0 || age >= WET_STEP_LIFE_TICKS) return -1;
  return Math.floor((age / WET_STEP_LIFE_TICKS) * WET_STEP_FRAMES);
}

/** One frame's size in world px, and the foot's place in it. */
export const WET_STEP_FRAME_W = 28;
export const WET_STEP_FRAME_H = 21;
export const WET_STEP_FOOT_X = 14;
export const WET_STEP_FOOT_Y = 13;

/** The ring's first and widest radius (px), and how far a second ring trails it in the splash's life. */
const RING_START_RADIUS_PX = 1;
const RING_END_RADIUS_PX = 11;
const RING_TRAIL = 0.3;
const RING_ALPHA = 0.85;
const TRAIL_RING_ALPHA = 0.5;
/** The splash holds its strength early and fades late: opacity falls as its life to this power. */
const FADE_POWER = 2;
/** Ground-plane squash of a ring: the projection draws ground at about half its depth. */
const RING_SQUASH = 2;
/** Share of a pixel off the ring's line that still draws at full strength; it is gone a pixel off. */
const RING_BAND_CORE = 0.35;
/** Floor on the distance from the centre, so the ring's slope stays finite there. */
const MIN_CENTRE_DISTANCE = 1e-3;
/** Share of the splash's life its droplets fly. */
const DROP_LIFE = 0.3;
/** A droplet's leap is a parabola over its flight; this scales it to peak at its rise. */
const ARC_PEAK_SCALE = 4;
const DROP_RADIUS_PX = 1.05;
/** Each droplet's side (-1 left .. 1 right), how far out it lands and how high it leaps (px). */
const DROPS: readonly (readonly [side: number, reach: number, rise: number])[] = [
  [-1, 8, 5],
  [-0.4, 6, 9],
  [0.45, 6.5, 7.5],
  [1, 9, 4.5],
];

const BYTE_MAX = 255;
const RGBA = 4;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A squashed ring's coverage at `(x, y)` from its centre, its band about a pixel thick all round. */
function ring(x: number, y: number, radius: number): number {
  const qy = y * RING_SQUASH;
  const d = Math.hypot(x, qy);
  const slope = Math.hypot(x, qy * RING_SQUASH) / Math.max(d, MIN_CENTRE_DISTANCE);
  return 1 - smoothstep(RING_BAND_CORE, 1, Math.abs(d - radius) / Math.max(slope, 1));
}

function splashCoverage(x: number, y: number, progress: number): number {
  const radiusAt = (p: number) => RING_START_RADIUS_PX + (RING_END_RADIUS_PX - RING_START_RADIUS_PX) * p;
  let cover = ring(x, y, radiusAt(progress)) * RING_ALPHA;
  if (progress > RING_TRAIL)
    cover = Math.max(cover, ring(x, y, radiusAt(progress - RING_TRAIL)) * TRAIL_RING_ALPHA);
  if (progress < DROP_LIFE) {
    const flight = progress / DROP_LIFE;
    for (const [side, reach, rise] of DROPS) {
      const dropX = side * reach * flight;
      const dropY = -rise * ARC_PEAK_SCALE * flight * (1 - flight);
      if (Math.hypot(x - dropX, y - dropY) < DROP_RADIUS_PX) cover = 1;
    }
  }
  return cover * (1 - progress ** FADE_POWER);
}

/** The splash's frames side by side in one premultiplied RGBA strip, frame `i` at `x = i * frame width`. */
export function wetStepStrip(): Uint8Array {
  const width = WET_STEP_FRAME_W * WET_STEP_FRAMES;
  const pixels = new Uint8Array(width * WET_STEP_FRAME_H * RGBA);
  for (let frame = 0; frame < WET_STEP_FRAMES; frame++) {
    const progress = (frame + 0.5) / WET_STEP_FRAMES;
    for (let py = 0; py < WET_STEP_FRAME_H; py++) {
      for (let px = 0; px < WET_STEP_FRAME_W; px++) {
        const cover = splashCoverage(px + 0.5 - WET_STEP_FOOT_X, py + 0.5 - WET_STEP_FOOT_Y, progress);
        if (cover <= 0) continue;
        const i = (py * width + frame * WET_STEP_FRAME_W + px) * RGBA;
        for (let c = 0; c < RAIN_SPLASH_RGB.length; c++)
          pixels[i + c] = Math.round((RAIN_SPLASH_RGB[c] ?? 0) * cover * BYTE_MAX);
        pixels[i + RAIN_SPLASH_RGB.length] = Math.round(cover * BYTE_MAX);
      }
    }
  }
  return pixels;
}
