import { frac } from './random.js';

/**
 * The wind a fast walker trails, an Open Northland addition: the original shows no sign of a carried
 * speed effect. Thin pale gusts are born at the walker's back, slide after it along a curved line and
 * die out, so the walker reads as carried by a tailwind. A gust stays where it was born, which bends
 * the trail round a corner the walker turns. Every size, life and share below is tuned by eye.
 */

/** Sim ticks a gust lives: the walker is about a step on by its end. */
export const WIND_GUST_LIFE_TICKS = 12;
/** Frames its life plays through. */
export const WIND_GUST_FRAMES = 20;
/** The line shapes a gust is drawn along: an arc, a wave, and a line that curls once. */
export const WIND_GUST_SHAPES = 3;
const SHAPE_ARC = 0;
const SHAPE_WAVE = 1;
/** A gust's opacity at its strongest; its frames carry the fade. */
export const WIND_GUST_ALPHA = 0.85;

/** One frame's size in world px. The line runs along +x from {@link WIND_GUST_TAIL_X}. */
export const WIND_GUST_FRAME_W = 62;
export const WIND_GUST_FRAME_H = 20;
export const WIND_GUST_TAIL_X = 3;
const HEAD_X = 59;
const MID_Y = WIND_GUST_FRAME_H / 2;
/** Texels painted per world px, so a turned line stays smooth under linear sampling. */
export const WIND_GUST_TEXELS_PER_PX = 2;

/** Ticks between two gusts of one walker, and the screen speed (world px a tick) it trails them from. */
export const WIND_GUST_EVERY_TICKS = 2.4;
export const WIND_GUST_MIN_SPEED = 1.5;
/** A faster jump is a door or a boarding, not a walk. */
export const WIND_GUST_MAX_SPEED = 16;
/** The screen speed (world px a tick) the painted line's length suits: the stroke's head then keeps just
 *  behind the walker's back. A gust is stretched by its walker's own speed over this one. */
const WIND_GUST_PAINTED_SPEED = 5.7;
/** The least and most a gust is stretched. */
const MIN_STRETCH = 0.6;
const MAX_STRETCH = 1.5;

/** How much longer than painted a gust of a walker at screen `speed` (world px a tick) is drawn. */
export function windGustStretch(speed: number): number {
  return Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, speed / WIND_GUST_PAINTED_SPEED));
}
/** How far behind the walker's middle a gust's tail is born (world px). */
const WIND_GUST_BEHIND = 9;

/** A walker's middle over its feet (world px), and the lanes the gusts run in across its heading from
 *  there: for a walk across the screen the calves, the waist and the shoulders. */
const BODY_MIDDLE = 17;
const LANE_OFFSETS: readonly number[] = [-10, 0, 10];
const LANE_JITTER = 3;
/** A walker coming down the screen hides what trails it behind its own height: its gusts are born this
 *  much further back, over its head (world px). */
const HEAD_CLEARANCE = 12;
/** A body is narrower than it is tall: the lanes of a walk up or down the screen close up by this share. */
const BODY_WIDTH_SHARE = 0.6;
/** Each gust's length as a share of the drawn line: no two in a row look alike. */
const MIN_LENGTH_SHARE = 0.75;

const SEED_LANE = 0;
const SEED_HEIGHT = 1;
const SEED_SHAPE = 2;
const SEED_FLIP = 3;
const SEED_LENGTH = 4;
const SEED_STREAMS = 5;

/** How one gust of a walker is drawn. */
export interface WindGust {
  /** World px off the walker's middle, across its heading. */
  readonly lane: number;
  /** Index into the painted shapes. */
  readonly shape: number;
  /** Mirrored across its line, so a curl turns either way. */
  readonly flipped: boolean;
  /** Its length as a share of the painted line. */
  readonly length: number;
}

/** The `index`-th gust of the walker `seed`. Lanes rotate, so the trail covers the whole body. */
export function windGust(seed: number, index: number): WindGust {
  const stream = index * SEED_STREAMS;
  const lanes = LANE_OFFSETS.length;
  const lane = (index + Math.floor(frac(seed, SEED_LANE) * lanes)) % lanes;
  return {
    lane: (LANE_OFFSETS[lane] ?? 0) + (frac(seed, stream + SEED_HEIGHT) * 2 - 1) * LANE_JITTER,
    shape: Math.floor(frac(seed, stream + SEED_SHAPE) * WIND_GUST_SHAPES),
    flipped: frac(seed, stream + SEED_FLIP) < 0.5,
    length: MIN_LENGTH_SHARE + frac(seed, stream + SEED_LENGTH) * (1 - MIN_LENGTH_SHARE),
  };
}

/** Where the tail of a gust in `lane` is born, from the feet of a walker heading along the unit
 *  `(dirX, dirY)` on screen (world px). */
export function windGustTailX(lane: number, dirX: number, dirY: number): number {
  return -dirX * WIND_GUST_BEHIND - dirY * lane * BODY_WIDTH_SHARE;
}

export function windGustTailY(lane: number, dirX: number, dirY: number): number {
  return -BODY_MIDDLE - dirY * (WIND_GUST_BEHIND + Math.max(0, dirY) * HEAD_CLEARANCE) + dirX * lane;
}

/** The frame a gust shows `age` ticks after its birth; -1 before it and once it is gone. */
export function windGustFrame(age: number): number {
  if (age < 0 || age >= WIND_GUST_LIFE_TICKS) return -1;
  return Math.floor((age / WIND_GUST_LIFE_TICKS) * WIND_GUST_FRAMES);
}

const TURN = Math.PI * 2;
const ARC_RISE = 5.5;
const WAVE_RISE = 3.8;
/** The curl: a loop of this radius the line turns once through, between these shares of its run. */
const CURL_RADIUS = 4;
const CURL_FROM = 0.42;
const CURL_TO = 0.86;
const CURL_DIP = 1.5;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The point of `shape`'s line at share `s` of its run, tail 0 to head 1, in frame px. */
function linePoint(shape: number, s: number): readonly [x: number, y: number] {
  const x = WIND_GUST_TAIL_X + (HEAD_X - WIND_GUST_TAIL_X) * s;
  if (shape === SHAPE_ARC) return [x, MID_Y + ARC_RISE * (0.5 - Math.sin(Math.PI * s))];
  if (shape === SHAPE_WAVE) return [x, MID_Y + WAVE_RISE * Math.sin(TURN * s)];
  const turn = smoothstep(CURL_FROM, CURL_TO, s) * TURN;
  return [
    x - CURL_RADIUS * Math.sin(turn),
    MID_Y + CURL_DIP * (1 - s) + CURL_RADIUS * (1 - Math.cos(turn)) - CURL_RADIUS,
  ];
}

/** Points sampled along a line: close enough that neighbouring dabs overlap at painting scale. */
const LINE_SAMPLES = 260;
/** The drawn stretch of the line over a gust's life: its head runs on at a steady pace, as if drawn out
 *  of the walker's back, and its tail follows late. */
const HEAD_START = 0.1;
const HEAD_POWER = 0.9;
const TAIL_END = 0.97;
const TAIL_POWER = 2.6;
/** The stroke's half width (px) at its tail and at its head. */
const TAIL_HALF_WIDTH = 0.4;
const HEAD_HALF_WIDTH = 1.05;
/** How far past the stroke's width its soft edge and its cool rim reach (px). */
const EDGE_PX = 0.55;
const RIM_PX = 1.5;
const RIM_ALPHA = 0.3;
/** The stroke thins to nothing over this share at its very head, so it ends in a point. */
const HEAD_POINT_SHARE = 0.12;
/** A gust comes up fast and lingers: opacity over its life. */
const FADE_IN_SHARE = 0.18;
const FADE_OUT_POWER = 1.4;

/** The stroke's own colour and the darker cool rim that keeps it readable on snow and sand. */
const STROKE_RGB: readonly number[] = [0.95, 0.985, 1];
const RIM_RGB: readonly number[] = [0.35, 0.5, 0.62];

const BYTE_MAX = 255;
const RGBA = 4;

/** Coverage of the stroke and of its rim, one texel each, for `shape` at `progress` of a gust's life. */
function paintFrame(shape: number, progress: number, stroke: Float32Array, rim: Float32Array): void {
  stroke.fill(0);
  rim.fill(0);
  const head = HEAD_START + (1 - HEAD_START) * progress ** HEAD_POWER;
  const tail = TAIL_END * progress ** TAIL_POWER;
  if (head <= tail) return;
  const fade = Math.min(1, progress / FADE_IN_SHARE) * (1 - progress ** FADE_OUT_POWER);
  const texelsW = WIND_GUST_FRAME_W * WIND_GUST_TEXELS_PER_PX;
  const texelsH = WIND_GUST_FRAME_H * WIND_GUST_TEXELS_PER_PX;
  for (let i = 0; i <= LINE_SAMPLES; i++) {
    const s = i / LINE_SAMPLES;
    if (s < tail || s > head) continue;
    const along = (s - tail) / (head - tail);
    const point = Math.min(1, (1 - along) / HEAD_POINT_SHARE);
    const halfWidth = (TAIL_HALF_WIDTH + (HEAD_HALF_WIDTH - TAIL_HALF_WIDTH) * along) * point;
    const strength = fade * Math.sqrt(along) * Math.min(1, point * 2);
    const [x, y] = linePoint(shape, s);
    const reach = halfWidth + RIM_PX;
    const fromX = Math.max(0, Math.floor((x - reach) * WIND_GUST_TEXELS_PER_PX));
    const toX = Math.min(texelsW - 1, Math.ceil((x + reach) * WIND_GUST_TEXELS_PER_PX));
    const fromY = Math.max(0, Math.floor((y - reach) * WIND_GUST_TEXELS_PER_PX));
    const toY = Math.min(texelsH - 1, Math.ceil((y + reach) * WIND_GUST_TEXELS_PER_PX));
    for (let ty = fromY; ty <= toY; ty++) {
      for (let tx = fromX; tx <= toX; tx++) {
        const d = Math.hypot(
          (tx + 0.5) / WIND_GUST_TEXELS_PER_PX - x,
          (ty + 0.5) / WIND_GUST_TEXELS_PER_PX - y,
        );
        const at = ty * texelsW + tx;
        const core = strength * (1 - smoothstep(halfWidth, halfWidth + EDGE_PX, d));
        if (core > (stroke[at] ?? 0)) stroke[at] = core;
        const halo = strength * RIM_ALPHA * (1 - smoothstep(halfWidth, reach, d));
        if (halo > (rim[at] ?? 0)) rim[at] = halo;
      }
    }
  }
}

/**
 * Every gust frame in one premultiplied RGBA sheet at {@link WIND_GUST_TEXELS_PER_PX}: a row per shape,
 * frame `i` at `x = i * frame width`.
 */
export function windGustSheet(): Uint8Array {
  const frameW = WIND_GUST_FRAME_W * WIND_GUST_TEXELS_PER_PX;
  const frameH = WIND_GUST_FRAME_H * WIND_GUST_TEXELS_PER_PX;
  const width = frameW * WIND_GUST_FRAMES;
  const pixels = new Uint8Array(width * frameH * WIND_GUST_SHAPES * RGBA);
  const stroke = new Float32Array(frameW * frameH);
  const rim = new Float32Array(frameW * frameH);
  for (let shape = 0; shape < WIND_GUST_SHAPES; shape++) {
    for (let frame = 0; frame < WIND_GUST_FRAMES; frame++) {
      paintFrame(shape, (frame + 0.5) / WIND_GUST_FRAMES, stroke, rim);
      for (let at = 0; at < stroke.length; at++) {
        const core = stroke[at] ?? 0;
        const halo = (rim[at] ?? 0) * (1 - core);
        if (core <= 0 && halo <= 0) continue;
        const px = at % frameW;
        const py = (at - px) / frameW;
        const i = ((shape * frameH + py) * width + frame * frameW + px) * RGBA;
        for (let c = 0; c < STROKE_RGB.length; c++)
          pixels[i + c] = Math.round(((STROKE_RGB[c] ?? 0) * core + (RIM_RGB[c] ?? 0) * halo) * BYTE_MAX);
        pixels[i + STROKE_RGB.length] = Math.round((core + halo) * BYTE_MAX);
      }
    }
  }
  return pixels;
}
