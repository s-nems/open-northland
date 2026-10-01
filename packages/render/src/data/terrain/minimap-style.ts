import { clamp } from '../math.js';
import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import { terrainWorldBounds } from './minimap.js';
import { buildMinimapCellField, FIELD_COVER } from './minimap-cells.js';
import { LandPainter } from './minimap-land.js';
import { MINIMAP_LIGHT } from './minimap-light.js';
import { hash2, smoothstep, valueNoise, valueNoisePair } from './minimap-noise.js';
import { SAMPLE_LANES, sampleField } from './minimap-sampler.js';
import type { MinimapScene } from './minimap-scene.js';
import { COAST, SeaPainter } from './minimap-sea.js';
import {
  contrastCurve,
  lightFrame,
  luma,
  mixToward,
  type Rgb,
  saturate,
  textureFade,
} from './minimap-texture.js';

/**
 * The styled minimap raster every consumer shares: lobby preview, pipeline card and in-game surface.
 * An Open Northland enhancement over the original's flat per-cell minimap, aiming at a relief-map look;
 * every look value below is a named approximation tuned by eye, not a measured or extracted one.
 */

/** Samples per cell pitch the raster aims for; smaller pictures supersample up to the cap per axis. */
const SAMPLES_PER_CELL = 1.5;
const MAX_SAMPLES = 4;
/** The coast's anti-aliased edge width in samples. */
const COAST_EDGE_SAMPLES = 1.2;
/** The surf line on the water side and the bank shade on the land side, in px, capped in water units. */
const FOAM_PX = 1;
const FOAM_MAX_BAND = 0.4;
const FOAM = 0xe4eee8;
const FOAM_ALPHA = 0.4;
const BANK_PX = 1.5;
const BANK_MAX_BAND = 0.45;
const BANK_SHADE = 0.22;
const SURF_FLOOR = 0.6;
const SURF_PERIOD_CELLS = 0.6;
/** The cell pitch in px up to which per-pixel grain keeps full strength; above it it scales by
 *  `GRAIN_FULL_PX / pitch`, down to the floor, since grain at one px per cell is noise at three. */
const GRAIN_FULL_PX = 1.2;
const GRAIN_MIN_SCALE = 0.2;
const GRAIN = 0.05;

/** Domain warp of the sample position, so ground-pattern borders and the coast do not follow the cell
 *  diamonds: its period and its largest offset, in cells. */
const WARP_PERIOD_CELLS = 1.6;
const WARP_CELLS = 0.3;

/** Seeds keeping the noise layers independent. */
const SEED_GRAIN = 0x9e3779b9;
const SEED_SURF = 0x7ed55d16;
const SEED_WARP = 0x1b873593;

const BYTE_MAX = 255;

/**
 * Rasterize the styled minimap: `pxW × pxH` RGBA, row-major, spanning `terrainWorldBounds`; opaque
 * except for an empty grid or picture, which stays all zero. Pure and deterministic; cost is one pass
 * over the cells plus one over the samples.
 */
export function rasterizeMinimap(scene: MinimapScene, pxW: number, pxH: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, pxW * pxH * 4));
  if (scene.width <= 0 || scene.height <= 0 || pxW <= 0 || pxH <= 0) return out;
  // Writes through the clamped view round and clamp each channel to a byte.
  const bytes = new Uint8ClampedArray(out.buffer);
  const bounds = terrainWorldBounds(scene.width, scene.height);
  const worldPerPxX = bounds.width / pxW;
  const worldPerPxY = bounds.height / pxH;
  const cellPx = Math.min((2 * TILE_HALF_W) / worldPerPxX, (2 * TILE_HALF_H) / worldPerPxY);
  const field = buildMinimapCellField(scene);
  const grainAmount = GRAIN * clamp(GRAIN_FULL_PX / cellPx, GRAIN_MIN_SCALE, 1);
  const samples = clamp(Math.ceil(SAMPLES_PER_CELL / cellPx), 1, MAX_SAMPLES);
  const coastEdge = Math.min(1, COAST_EDGE_SAMPLES / (cellPx * samples));
  const foamBand = Math.min(FOAM_MAX_BAND, FOAM_PX / cellPx);
  const bankBand = Math.min(BANK_MAX_BAND, BANK_PX / cellPx);
  // Sub-cell texture fades in with the pitch and stays off while the picture supersamples, so it never
  // needs supersampling itself.
  const textured = samples === 1;
  const light = lightFrame(MINIMAP_LIGHT);
  const land = new LandPainter(cellPx, textured, light);
  const sea = new SeaPainter(cellPx, textured, light);
  const sample: Rgb = { r: 0, g: 0, b: 0 };
  const seaRgb: Rgb = { r: 0, g: 0, b: 0 };
  const s = new Float64Array(SAMPLE_LANES);
  const warp = new Float64Array(2);
  const curve = contrastCurve();
  const inv = 1 / (samples * samples);
  const cellW = 2 * TILE_HALF_W;
  const warpScale = 1 / (WARP_PERIOD_CELLS * cellW);
  const warpReach = textured ? 2 * WARP_CELLS * cellW * textureFade(WARP_PERIOD_CELLS, cellPx) : 0;
  const surfScale = 1 / (SURF_PERIOD_CELLS * cellW);
  for (let py = 0; py < pxH; py++) {
    const rowY = bounds.minY + (py + 0.5) * worldPerPxY;
    for (let px = 0; px < pxW; px++) {
      let x = bounds.minX + (px + 0.5) * worldPerPxX;
      let y = rowY;
      if (warpReach > 0) {
        valueNoisePair(x * warpScale, y * warpScale, SEED_WARP, warp);
        x += ((warp[0] ?? 0.5) - 0.5) * warpReach;
        y += ((warp[1] ?? 0.5) - 0.5) * warpReach;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        const wy = y + ((sy + 0.5) / samples - 0.5) * worldPerPxY;
        for (let sx = 0; sx < samples; sx++) {
          const wx = x + ((sx + 0.5) / samples - 0.5) * worldPerPxX;
          sampleField(field, scene.width, scene.height, wx, wy, s);
          const water = s[FIELD_COVER] ?? 0;
          const edgeT = (water - COAST) / coastEdge + 0.5;
          const cover = edgeT <= 0 ? 0 : edgeT >= 1 ? 1 : smoothstep(edgeT);
          sample.r = 0;
          sample.g = 0;
          sample.b = 0;
          if (cover < 1) {
            land.paint(s, wx, wy, px, py, sample);
            const bank = 1 - (COAST - water) / bankBand;
            const share = bank > 0 ? (1 - cover) * (1 - BANK_SHADE * Math.min(1, bank)) : 1 - cover;
            sample.r *= share;
            sample.g *= share;
            sample.b *= share;
          }
          if (cover > 0) {
            sea.paint(s, wx, wy, seaRgb);
            sample.r += seaRgb.r * cover;
            sample.g += seaRgb.g * cover;
            sample.b += seaRgb.b * cover;
            const edge = 1 - (water - COAST) / foamBand;
            if (edge > 0) {
              // Foam paints over the whole sample, land share included.
              const surf = valueNoise(wx * surfScale, wy * surfScale, SEED_SURF);
              mixToward(
                sample,
                FOAM,
                cover * Math.min(1, edge) * FOAM_ALPHA * (SURF_FLOOR + (1 - SURF_FLOOR) * surf),
              );
            }
          }
          r += sample.r;
          g += sample.g;
          b += sample.b;
        }
      }
      const grain = inv * (1 + grainAmount * (hash2(px, py, SEED_GRAIN) - 0.5));
      r *= grain;
      g *= grain;
      b *= grain;
      const y0 = luma(r, g, b);
      const o = (py * pxW + px) * 4;
      bytes[o] = curve[toByte(saturate(r, y0))] ?? 0;
      bytes[o + 1] = curve[toByte(saturate(g, y0))] ?? 0;
      bytes[o + 2] = curve[toByte(saturate(b, y0))] ?? 0;
      bytes[o + 3] = BYTE_MAX;
    }
  }
  return out;
}

function toByte(v: number): number {
  return v <= 0 ? 0 : v >= BYTE_MAX ? BYTE_MAX : (v + 0.5) | 0;
}
