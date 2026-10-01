/** Deterministic integer-hash noise for the minimap's texture: no `Math.random`, same input same picture. */

const HASH_SCALE = 1 / 4294967296;
const HALF_WORD = 0x10000;

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** An integer lattice hash as an unsigned 32-bit integer. */
export function hashBits(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** An integer lattice hash in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  return hashBits(x, y, seed) * HASH_SCALE;
}

/** Smooth value noise in [0, 1) over a unit lattice. */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  return bilinear(
    hash2(ix, iy, seed),
    hash2(ix + 1, iy, seed),
    hash2(ix, iy + 1, seed),
    hash2(ix + 1, iy + 1, seed),
    smoothstep(x - ix),
    smoothstep(y - iy),
  );
}

/**
 * Two independent smooth value noises in [0, 1) over one unit lattice, from the low and high halves of
 * one hash per corner: half the hashing of two {@link valueNoise} calls. Writes `out[0]` and `out[1]`.
 */
export function valueNoisePair(x: number, y: number, seed: number, out: Float64Array): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = smoothstep(x - ix);
  const ty = smoothstep(y - iy);
  const a = hashBits(ix, iy, seed);
  const b = hashBits(ix + 1, iy, seed);
  const c = hashBits(ix, iy + 1, seed);
  const d = hashBits(ix + 1, iy + 1, seed);
  out[0] = bilinear(low(a), low(b), low(c), low(d), tx, ty);
  out[1] = bilinear(high(a), high(b), high(c), high(d), tx, ty);
}

const low = (h: number): number => (h & (HALF_WORD - 1)) / HALF_WORD;
const high = (h: number): number => (h >>> 16) / HALF_WORD;

function bilinear(a: number, b: number, c: number, d: number, tx: number, ty: number): number {
  return a + (b - a) * tx + (c - a + (d - c - (b - a)) * tx) * ty;
}
