/** Deterministic integer-hash noise for the minimap's texture: no `Math.random`, same input same picture. */

const HASH_SCALE = 1 / 4294967296;

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** An integer lattice hash in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) * HASH_SCALE;
}

/** Smooth value noise in [0, 1) over a unit lattice. */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = smoothstep(x - ix);
  const ty = smoothstep(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a + (d - c - (b - a)) * tx) * ty;
}
