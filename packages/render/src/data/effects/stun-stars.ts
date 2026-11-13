import { frac } from './random.js';

/**
 * The stars that circle a stunned body's head, an Open Northland addition: the original has no stun.
 * They ride a flat ring over the head, passing in front of it and then behind. Extents in world px at
 * zoom 1 and times in sim ticks, tuned by eye.
 */

export const STUN_STARS = 3;
/** Sim ticks one turn round the head takes. */
const TURN_TICKS = 22;
const RING_RADIUS_X = 9;
/** The ring is seen from above at the map's angle, so the projection squashes it. */
const RING_RADIUS_Y = 3;
/** How far over the top of the body the ring's middle floats: below it, so the ring girds the head
 *  and a star on the far side passes behind it. */
export const STUN_RING_LIFT = -5;
/** A star on the far side of the ring draws smaller, which gives the ring its depth. */
const FAR_SCALE = 0.7;
const TURN = Math.PI * 2;

/** One star of the ring, written in place. */
export interface StunStar {
  /** Offsets from the ring's middle, world px. */
  x: number;
  y: number;
  /** Against the frame drawn at {@link STUN_STAR_DRAW_SCALE}. */
  scale: number;
  rotation: number;
  /** Whether the star is on the camera's side of the head, so it paints over the body. */
  front: boolean;
}

/** Star `star` of a stunned body's ring at `renderTime` ticks, written to `out`. `seed` sets where on
 *  the ring the stars start, so a stunned rank does not turn in step. */
export function stunStar(renderTime: number, seed: number, star: number, out: StunStar): void {
  const angle = (renderTime / TURN_TICKS + frac(seed, 0) + star / STUN_STARS) * TURN;
  const near = Math.sin(angle);
  out.x = Math.cos(angle) * RING_RADIUS_X;
  out.y = near * RING_RADIUS_Y;
  out.scale = FAR_SCALE + ((1 - FAR_SCALE) * (near + 1)) / 2;
  out.rotation = angle;
  out.front = near >= 0;
}

/** The side of the star frame in texels, and the scale it draws at: half-size texels keep the star
 *  smooth when the camera closes in. */
export const STUN_STAR_FRAME_PX = 24;
export const STUN_STAR_DRAW_SCALE = 0.4;

const STAR_POINTS = 5;
/** Shares of the frame's half side: the tips reach the first, the notches between them the second. */
const TIP_RADIUS = 0.92;
const NOTCH_RADIUS = 0.42;
/** The edge's soft band, as a share of the half side. */
const EDGE_SOFTNESS = 0.08;
const STAR_YELLOW = [255, 221, 64] as const;
const STAR_RIM = [176, 104, 0] as const;
/** Width of the dark rim inside the edge, as a share of the half side. */
const RIM_WIDTH = 0.12;
const BYTE_MAX = 255;
const RGBA = 4;

/** A five-pointed star's outline radius toward `angle`, as a share of the frame's half side. */
function outlineRadius(angle: number): number {
  const sector = TURN / STAR_POINTS;
  // Fold the angle into half a point: 0 at a tip, sector / 2 at a notch.
  const folded = Math.abs((((angle % sector) + sector) % sector) - sector / 2);
  const toTip = sector / 2 - folded;
  // The edge between a tip and a notch is a straight line, in polar form.
  const tipX = TIP_RADIUS;
  const notchX = NOTCH_RADIUS * Math.cos(sector / 2);
  const notchY = NOTCH_RADIUS * Math.sin(sector / 2);
  const cos = Math.cos(toTip);
  const sin = Math.sin(toTip);
  return (tipX * notchY) / (notchY * cos + (tipX - notchX) * sin);
}

/** The star frame as premultiplied RGBA: a yellow five-pointed star with a darker rim. */
export function stunStarFrame(): Uint8Array {
  const frame = new Uint8Array(STUN_STAR_FRAME_PX * STUN_STAR_FRAME_PX * RGBA);
  const half = STUN_STAR_FRAME_PX / 2;
  for (let y = 0; y < STUN_STAR_FRAME_PX; y++) {
    for (let x = 0; x < STUN_STAR_FRAME_PX; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      // A tip points up.
      const inside = outlineRadius(Math.atan2(dy, dx) + Math.PI / 2) - Math.hypot(dx, dy);
      const alpha = Math.min(1, Math.max(0, inside / EDGE_SOFTNESS));
      const rim = 1 - Math.min(1, Math.max(0, inside / RIM_WIDTH));
      const at = (y * STUN_STAR_FRAME_PX + x) * RGBA;
      for (let c = 0; c < STAR_YELLOW.length; c++) {
        const fill = STAR_YELLOW[c] ?? 0;
        const edge = STAR_RIM[c] ?? 0;
        frame[at + c] = Math.round((fill + (edge - fill) * rim) * alpha);
      }
      frame[at + 3] = Math.round(alpha * BYTE_MAX);
    }
  }
  return frame;
}
