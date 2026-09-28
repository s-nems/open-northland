/** A deterministic 0..1 hash of an integer lattice point, so a baked foot looks the same every load. */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 0xffffffff;
}

/** Smooth 0..1 value noise along one axis, one lattice point per unit of `x`; `seed` picks the stream. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const t = x - i;
  const a = hash2(i, seed);
  return a + (hash2(i + 1, seed) - a) * smoothstep(0, 1, t);
}

export function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}
