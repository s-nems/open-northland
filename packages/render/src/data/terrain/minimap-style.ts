import { clamp, clamp01 } from '../math.js';
import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import { terrainWorldBounds } from './minimap.js';
import {
  buildMinimapCellField,
  FIELD_COVER,
  FIELD_FOREST,
  FIELD_LAND_B,
  FIELD_LAND_G,
  FIELD_LAND_R,
  FIELD_ORE,
  FIELD_ORE_B,
  FIELD_ORE_G,
  FIELD_ORE_R,
  FIELD_WATER_B,
  FIELD_WATER_G,
  FIELD_WATER_R,
} from './minimap-cells.js';
import { hash2, smoothstep, valueNoise } from './minimap-noise.js';
import { SAMPLE_LANES, sampleField } from './minimap-sampler.js';
import type { MinimapScene } from './minimap-scene.js';

/**
 * The styled minimap raster every consumer shares: lobby preview, pipeline card and in-game surface.
 * An Open Northland enhancement over the original's flat per-cell minimap; every look value below is a
 * named approximation tuned by eye, not a measured or extracted one.
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
/** A cell's pitch in px below which sub-cell texture fades out instead of aliasing, and its fade span.
 *  It starts where supersampling does, so texture never needs to be supersampled. */
const DETAIL_FADE_START_PX = SAMPLES_PER_CELL;
const DETAIL_FADE_SPAN_PX = 3;

/** Texture amplitudes and periods: per-pixel grain, canopy crowns, water ripples, surf breaks. */
const GRAIN = 0.05;
const CROWN_DEPTH = 0.25;
const CROWN_PERIOD_CELLS = 0.6;
const RIPPLE = 0.12;
const RIPPLE_LENGTH_CELLS = 1.4;
const RIPPLE_HEIGHT_CELLS = 0.3;
const SURF_FLOOR = 0.6;
/** Ore shows as glints at full detail and as an even tint once the picture is too small for them. */
const ORE_PERIOD_CELLS = 0.45;
const ORE_GLINT_SOFTNESS = 0.12;
const ORE_GLINT_COVER = 0.25;
const ORE_GLINT_STRENGTH = 0.6;
const ORE_TINT = 0.2;
/** Seeds keeping the noise layers independent. */
const SEED_GRAIN = 0x9e3779b9;
const SEED_CROWN = 0x2545f491;
const SEED_RIPPLE = 0x5851f42d;
const SEED_ORE = 0x68e31da4;

/** The water coverage the coast contour sits at. */
const COAST = 0.5;
/** Marks a per-pixel noise value not yet evaluated (every noise is ≥ 0). */
const UNSET = -1;
const BYTE_MAX = 255;

/**
 * Rasterize the styled minimap: `pxW × pxH` RGBA, row-major, opaque, spanning `terrainWorldBounds`.
 * Pure and deterministic; cost is one pass over the cells plus one over the samples.
 */
export function rasterizeMinimap(scene: MinimapScene, pxW: number, pxH: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, pxW * pxH * 4));
  if (scene.width <= 0 || scene.height <= 0 || pxW <= 0 || pxH <= 0) return out;
  // Writes through the clamped view round and clamp each channel to a byte.
  const bytes = new Uint8ClampedArray(out.buffer);
  const field = buildMinimapCellField(scene);
  const bounds = terrainWorldBounds(scene.width, scene.height);
  const worldPerPxX = bounds.width / pxW;
  const worldPerPxY = bounds.height / pxH;
  const cellPx = Math.min((2 * TILE_HALF_W) / worldPerPxX, (2 * TILE_HALF_H) / worldPerPxY);
  const samples = clamp(Math.ceil(SAMPLES_PER_CELL / cellPx), 1, MAX_SAMPLES);
  const coastEdge = Math.min(1, COAST_EDGE_SAMPLES / (cellPx * samples));
  const foamBand = Math.min(FOAM_MAX_BAND, FOAM_PX / cellPx);
  const bankBand = Math.min(BANK_MAX_BAND, BANK_PX / cellPx);
  const detail = clamp01((cellPx - DETAIL_FADE_START_PX) / DETAIL_FADE_SPAN_PX);
  const s = new Float64Array(SAMPLE_LANES);
  const inv = 1 / (samples * samples);
  const cellW = 2 * TILE_HALF_W;
  const crownScale = 1 / (CROWN_PERIOD_CELLS * cellW);
  const oreScale = 1 / (ORE_PERIOD_CELLS * cellW);
  const rippleX = 1 / (RIPPLE_LENGTH_CELLS * cellW);
  const rippleY = 1 / (RIPPLE_HEIGHT_CELLS * 2 * TILE_HALF_H);
  const foamR = (FOAM >> 16) & 0xff;
  const foamG = (FOAM >> 8) & 0xff;
  const foamB = FOAM & 0xff;
  for (let py = 0; py < pxH; py++) {
    const cy = bounds.minY + (py + 0.5) * worldPerPxY;
    for (let px = 0; px < pxW; px++) {
      const cx = bounds.minX + (px + 0.5) * worldPerPxX;
      // Texture noise is evaluated at most once per pixel, and only where a sample needs it; sub-cell
      // texture is off (detail 0) whenever the picture supersamples, so this never aliases.
      let crownNoise = UNSET;
      let ripple = UNSET;
      let oreNoise = UNSET;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        const wy = bounds.minY + (py + (sy + 0.5) / samples) * worldPerPxY;
        for (let sx = 0; sx < samples; sx++) {
          const wx = bounds.minX + (px + (sx + 0.5) / samples) * worldPerPxX;
          sampleField(field, scene.width, scene.height, wx, wy, s);
          const water = s[FIELD_COVER] ?? 0;
          const forest = s[FIELD_FOREST] ?? 0;
          const ore = s[FIELD_ORE] ?? 0;
          const edgeT = (water - COAST) / coastEdge + 0.5;
          const cover = edgeT <= 0 ? 0 : edgeT >= 1 ? 1 : smoothstep(edgeT);
          let sr = 0;
          let sg = 0;
          let sb = 0;
          if (cover < 1) {
            let landR = s[FIELD_LAND_R] ?? 0;
            let landG = s[FIELD_LAND_G] ?? 0;
            let landB = s[FIELD_LAND_B] ?? 0;
            if (ore > 0) {
              let share = ORE_TINT * ore;
              if (detail > 0) {
                if (oreNoise === UNSET) oreNoise = valueNoise(cx * oreScale, cy * oreScale, SEED_ORE);
                const glint = smoothstep(
                  clamp01((oreNoise - 1 + ore * ORE_GLINT_COVER) / ORE_GLINT_SOFTNESS),
                );
                share += glint * ORE_GLINT_STRENGTH * detail;
              }
              // The ore lanes are premultiplied by density; dividing restores the tint.
              const mix = share / ore;
              landR += (s[FIELD_ORE_R] ?? 0) * mix - landR * share;
              landG += (s[FIELD_ORE_G] ?? 0) * mix - landG * share;
              landB += (s[FIELD_ORE_B] ?? 0) * mix - landB * share;
            }
            const bank = 1 - (COAST - water) / bankBand;
            let mul = bank > 0 ? (1 - cover) * (1 - BANK_SHADE * Math.min(1, bank)) : 1 - cover;
            if (forest > 0 && detail > 0) {
              if (crownNoise === UNSET) crownNoise = valueNoise(cx * crownScale, cy * crownScale, SEED_CROWN);
              mul *= 1 - CROWN_DEPTH * detail * crownNoise * forest;
            }
            sr = landR * mul;
            sg = landG * mul;
            sb = landB * mul;
          }
          if (cover > 0) {
            let mul = cover;
            if (detail > 0) {
              if (ripple === UNSET)
                ripple = 1 + RIPPLE * detail * (valueNoise(cx * rippleX, cy * rippleY, SEED_RIPPLE) - 0.5);
              mul *= ripple;
            }
            const edge = 1 - (water - COAST) / foamBand;
            let foam = 0;
            if (edge > 0) {
              // The surf breaks on the crown noise: the two never overlap, one is land and one water.
              if (crownNoise === UNSET) crownNoise = valueNoise(cx * crownScale, cy * crownScale, SEED_CROWN);
              foam = cover * Math.min(1, edge) * FOAM_ALPHA * (SURF_FLOOR + (1 - SURF_FLOOR) * crownNoise);
            }
            // Foam paints over the whole sample, land share included.
            const keep = 1 - foam;
            sr = (sr + (s[FIELD_WATER_R] ?? 0) * mul) * keep + foamR * foam;
            sg = (sg + (s[FIELD_WATER_G] ?? 0) * mul) * keep + foamG * foam;
            sb = (sb + (s[FIELD_WATER_B] ?? 0) * mul) * keep + foamB * foam;
          }
          r += sr;
          g += sg;
          b += sb;
        }
      }
      const grain = inv * (1 + GRAIN * (hash2(px, py, SEED_GRAIN) - 0.5));
      const o = (py * pxW + px) * 4;
      bytes[o] = r * grain;
      bytes[o + 1] = g * grain;
      bytes[o + 2] = b * grain;
      bytes[o + 3] = BYTE_MAX;
    }
  }
  return out;
}
