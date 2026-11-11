import { BufferImageSource } from 'pixi.js';

/**
 * The value-noise lattice behind the ground cover, read from a texture instead of hashed per fragment.
 * Each float32 texel holds its cell's four corners, so a lookup is one fetch and the shader keeps the
 * cell interpolation. The lattice tiles every {@link COVER_NOISE_PERIOD} cells; inside the first period
 * it holds the values the arithmetic hash gave, so only the far repeats differ from it.
 */

/** Lattice cells per tile, a power of two so a cell wraps with a mask. */
export const COVER_NOISE_PERIOD = 256;
/** The hash's odd 32-bit multipliers, shared with the GLSL `coverHash`. */
export const COVER_HASH_SCALE = [1597334673, 3812015801] as const;
/** A hash keeps its top 24 bits, the fraction a float32 holds exactly. */
const HASH_DROPPED_BITS = 8;
const HASH_FRACTION_ONE = 2 ** 24;
/** Corners per texel: the cell itself, then its right, lower and diagonal neighbours. */
const CORNERS = 4;

/** The 0..1 value of lattice cell (x, y), wrapped on the period: the GLSL `coverHash` of that cell. */
export function coverLatticeValue(x: number, y: number): number {
  const mask = COVER_NOISE_PERIOD - 1;
  const qx = Math.imul(x & mask, COVER_HASH_SCALE[0]);
  const qy = Math.imul(y & mask, COVER_HASH_SCALE[1]);
  return (Math.imul(qx ^ qy, COVER_HASH_SCALE[0]) >>> HASH_DROPPED_BITS) / HASH_FRACTION_ONE;
}

/** Texel (x, y) holds cells (x, y), (x + 1, y), (x, y + 1) and (x + 1, y + 1), row-major. */
export function coverNoiseLattice(): Float32Array {
  const period = COVER_NOISE_PERIOD;
  const out = new Float32Array(period * period * CORNERS);
  for (let y = 0; y < period; y++) {
    for (let x = 0; x < period; x++) {
      const o = (y * period + x) * CORNERS;
      out[o] = coverLatticeValue(x, y);
      out[o + 1] = coverLatticeValue(x + 1, y);
      out[o + 2] = coverLatticeValue(x, y + 1);
      out[o + 3] = coverLatticeValue(x + 1, y + 1);
    }
  }
  return out;
}

let shared: BufferImageSource | null = null;

/** The lattice texture every cover shader binds as `uCoverNoise`; built on first use and kept. */
export function coverNoiseSource(): BufferImageSource {
  shared ??= new BufferImageSource({
    resource: coverNoiseLattice(),
    width: COVER_NOISE_PERIOD,
    height: COVER_NOISE_PERIOD,
    format: 'rgba32float',
    // Read with texelFetch only; float32 is not filterable everywhere.
    scaleMode: 'nearest',
    // The fourth corner is a value, not coverage.
    alphaMode: 'no-premultiply-alpha',
  });
  return shared;
}
