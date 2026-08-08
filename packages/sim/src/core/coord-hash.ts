/**
 * A deterministic 32-bit hash of an integer pair, the sim's way to derive stable per-location or
 * per-event variation without drawing from `ctx.rng`: taking it from the seeded RNG would couple the
 * variation to the command stream, while a hash stays byte-stable across runs and replays.
 *
 * Callers key on the low bits (`% bands`, `& 1`), so the combined word must be avalanched before it is
 * returned: without the murmur3 finalizer below, bit k of `imul(x,A) ^ imul(y,B)` depends only on bits
 * 0..k of x and y, and lattice inputs whose low bits are constant collapse a `% 8` band pick to 4 values.
 */
/** Per-axis mixing words, distinct so `(x, y)` and `(y, x)` cannot collide. `HASH_Y` shares its value
 *  with {@link FMIX_M1} only because both come from murmur3's constant pool; they are separate knobs. */
const HASH_X = 0x9e3779b1;
const HASH_Y = 0x85ebca6b;

/** The murmur3 `fmix32` finalizer's two multipliers - the avalanche step, unrelated to the axis words. */
const FMIX_M1 = 0x85ebca6b;
const FMIX_M2 = 0xc2b2ae35;

export function pairHash(a: number, b: number): number {
  let h = (Math.imul(a, HASH_X) ^ Math.imul(b, HASH_Y)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), FMIX_M1) >>> 0;
  h = Math.imul(h ^ (h >>> 13), FMIX_M2) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function coordHash(x: number, y: number): number {
  return pairHash(x, y);
}
