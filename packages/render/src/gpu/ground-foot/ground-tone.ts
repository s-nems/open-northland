import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import type { BrightnessField, ElevationField } from '../../data/terrain/index.js';
import { MINIMAP_CELL_UNRESOLVED } from '../../data/terrain/index.js';
import type { GroundColours } from './foot-ground.js';

const CHANNEL_MAX = 0xff;
/** Reach of one cell's colour around its centre, in px across the ground: a little under a cell, so a
 *  point takes its own cell's colour and blends only toward the ones it borders. */
const POINT_RADIUS_PX = 44;
/** Rows are half as tall as cells are wide, so a vertical px spans twice the ground. */
const CELL_ASPECT = (2 * TILE_HALF_W) / TILE_HALF_H;
/** Points this close share one memoized colour. */
const POINT_QUANT_PX = 4;
const POINT_KEY_STRIDE = 1 << 16;
const NO_COLOUR = -1;

/**
 * The colour of the ground as the terrain draws it: the per-cell colours averaged from the ground texture
 * pages, shaded by the map's baked brightness and blended between neighbouring cells. Memoized per point.
 */
export class GroundTone implements GroundColours {
  private readonly memo = new Map<number, number>();

  constructor(
    private readonly cells: Uint32Array,
    private readonly width: number,
    private readonly height: number,
    private readonly brightness: BrightnessField,
    private readonly elevation: ElevationField | undefined,
  ) {}

  /** `0xRRGGBB` of the ground at a lifted pre-camera screen point, or undefined off the coloured map. */
  pointAt(x: number, y: number): number | undefined {
    const qx = Math.round(x / POINT_QUANT_PX);
    const qy = Math.round(y / POINT_QUANT_PX);
    const key = qy * POINT_KEY_STRIDE + qx;
    const memo = this.memo.get(key);
    if (memo !== undefined) return memo === NO_COLOUR ? undefined : memo;
    const tone = this.blend(qx * POINT_QUANT_PX, qy * POINT_QUANT_PX);
    this.memo.set(key, tone ?? NO_COLOUR);
    return tone;
  }

  private blend(x: number, y: number): number | undefined {
    const row = this.rowUnder(x, y);
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let rr = row - 1; rr <= row + 1; rr++) {
      if (rr < 0 || rr >= this.height) continue;
      const stagger = rr & 1;
      const cy = rr * TILE_HALF_H - this.liftAt(x, rr);
      const col0 = Math.round((x / TILE_HALF_W - stagger) / 2);
      for (let c = col0 - 1; c <= col0 + 1; c++) {
        if (c < 0 || c >= this.width) continue;
        const colour = this.cells[rr * this.width + c] ?? MINIMAP_CELL_UNRESOLVED;
        if (colour >= MINIMAP_CELL_UNRESOLVED) continue;
        const cx = (2 * c + stagger) * TILE_HALF_W;
        const w = 1 - Math.hypot(x - cx, (y - cy) * CELL_ASPECT) / POINT_RADIUS_PX;
        if (w <= 0) continue;
        const shade = this.brightness.brightnessAt(c, rr) * w;
        r += ((colour >> 16) & CHANNEL_MAX) * shade;
        g += ((colour >> 8) & CHANNEL_MAX) * shade;
        b += (colour & CHANNEL_MAX) * shade;
        weight += w;
      }
    }
    if (weight === 0) return undefined;
    const channel = (sum: number): number => Math.min(CHANNEL_MAX, Math.round(sum / weight));
    return (channel(r) << 16) | (channel(g) << 8) | channel(b);
  }

  /** The cell row whose lifted centre line is nearest a lifted screen `y`. */
  private rowUnder(x: number, y: number): number {
    const first = Math.floor(y / TILE_HALF_H);
    const last = Math.ceil((y + (this.elevation?.maxLift ?? 0)) / TILE_HALF_H);
    let best = first;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let r = first; r <= last; r++) {
      const err = Math.abs(r * TILE_HALF_H - this.liftAt(x, r) - y);
      if (err < bestErr) {
        bestErr = err;
        best = r;
      }
    }
    return best;
  }

  private liftAt(x: number, row: number): number {
    return this.elevation?.liftAt(Math.max(0, Math.round(x / (2 * TILE_HALF_W))), row) ?? 0;
  }
}
