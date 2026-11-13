import { frac } from './random.js';

/**
 * The sign a worn amulet shows on its wearer, an Open Northland addition: the original draws nothing for
 * one. A short arc of light runs round the feet on the ground, passing in front of the wearer and then
 * behind. Each amulet kind the app colours gets one arc, the arcs spaced evenly round the one ring, so
 * their count tells how many kinds the wearer carries. Extents in world px at zoom 1 and times in sim
 * ticks, tuned by eye.
 */

/** Sim ticks one turn round the wearer takes. */
const TURN_TICKS = 44;
const RING_RADIUS_X = 17;
/** The ring lies on the ground, so the projection squashes it. */
const RING_RADIUS_Y = 7.5;

/** The dots one arc draws: its head and the tail behind it. */
export const ARC_DOTS = 8;
/** How far behind the dot before it each tail dot trails, as a share of a turn. */
const TAIL_SPACING_TURNS = 0.022;
/** Each tail dot's size and opacity against the one before it. */
const TAIL_SCALE_FALLOFF = 0.9;
const TAIL_ALPHA_FALLOFF = 0.76;
const HEAD_SCALE = 0.62;
const HEAD_ALPHA = 0.9;

const TURN = Math.PI * 2;

/** One dot of an arc, written in place. */
export interface ArcDot {
  /** Offsets from the wearer's feet, world px. */
  x: number;
  y: number;
  /** Against the frame drawn at {@link ARC_DRAW_SCALE}. */
  scale: number;
  alpha: number;
  /** Whether the dot is on the camera's side of the wearer, so it paints over the body. */
  front: boolean;
}

/**
 * Dot `dot` (0 the head) of arc `arc` among a wearer's `arcs` at `renderTime` ticks, written to `out`.
 * `seed` sets where on the ring the wearer's arcs start, so a company does not turn in step.
 */
export function arcDot(
  renderTime: number,
  seed: number,
  arc: number,
  arcs: number,
  dot: number,
  out: ArcDot,
): void {
  const angle = (renderTime / TURN_TICKS + frac(seed, 0) + arc / arcs - dot * TAIL_SPACING_TURNS) * TURN;
  const near = Math.sin(angle);
  out.x = Math.cos(angle) * RING_RADIUS_X;
  out.y = near * RING_RADIUS_Y;
  out.scale = HEAD_SCALE * TAIL_SCALE_FALLOFF ** dot;
  out.alpha = HEAD_ALPHA * TAIL_ALPHA_FALLOFF ** dot;
  out.front = near >= 0;
}

/** The side of one dot frame in texels, and the scale it draws at: half-size texels keep the dot
 *  smooth when the camera closes in. */
export const ARC_FRAME_PX = 24;
export const ARC_DRAW_SCALE = 0.65;

/** Shares of the frame's half side: the white-hot middle ends at the first, the colour's own light at
 *  the second, and the halo reaches the frame's edge. */
const CORE_RADIUS = 0.16;
const BODY_RADIUS = 0.4;
const HALO_ALPHA = 0.45;
/** How far toward white the middle of a dot stands from its colour. */
const CORE_LIGHTEN = 0.8;

const BYTE_MAX = 255;
const RGBA = 4;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * One dot frame per colour (0xRRGGBB), side by side in a premultiplied RGBA strip: a near-white middle,
 * the colour around it, and a faint halo of the colour that is gone at the frame's edge.
 */
export function arcDotStrip(colours: readonly number[]): Uint8Array {
  const width = ARC_FRAME_PX * colours.length;
  const strip = new Uint8Array(width * ARC_FRAME_PX * RGBA);
  const half = ARC_FRAME_PX / 2;
  for (let frame = 0; frame < colours.length; frame++) {
    const colour = colours[frame] ?? 0;
    const channels = [
      (colour >> RED_SHIFT) & BYTE_MAX,
      (colour >> GREEN_SHIFT) & BYTE_MAX,
      colour & BYTE_MAX,
    ];
    for (let y = 0; y < ARC_FRAME_PX; y++) {
      for (let x = 0; x < ARC_FRAME_PX; x++) {
        const r = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
        const halo = HALO_ALPHA * (1 - smoothstep(0, 1, r)) ** 2;
        const alpha = Math.min(1, 1 - smoothstep(CORE_RADIUS, BODY_RADIUS, r) + halo);
        const white = CORE_LIGHTEN * (1 - smoothstep(0, BODY_RADIUS, r));
        const at = (y * width + frame * ARC_FRAME_PX + x) * RGBA;
        for (let c = 0; c < channels.length; c++) {
          const channel = channels[c] ?? 0;
          strip[at + c] = Math.round((channel + (BYTE_MAX - channel) * white) * alpha);
        }
        strip[at + 3] = Math.round(alpha * BYTE_MAX);
      }
    }
  }
  return strip;
}
