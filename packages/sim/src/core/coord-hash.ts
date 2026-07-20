/**
 * A deterministic 32-bit hash of an integer grid coordinate pair — the sim's way to derive stable
 * per-location variation WITHOUT touching `world.rng`. Drawing such variation from the seeded RNG would
 * couple it to the command stream (a different command order would shift every later draw), so anything
 * keyed by *where* it happened hashes the place instead and stays byte-stable across runs and replays.
 *
 * Callers key on the LOW bits (`% bands`, `& 1`), so the combined word must be avalanched before it is
 * returned: without the murmur3 finalizer below, bit k of `imul(x,A) ^ imul(y,B)` depends only on bits
 * 0..k of x and y, and the callers' inputs are lattice points whose low bits are constant — which
 * silently collapses a `% 8` band pick to 4 values and an `& 1` coin flip to one face.
 */
const HASH_X = 0x9e3779b1;
const HASH_Y = 0x85ebca6b;

export function coordHash(x: number, y: number): number {
  let h = (Math.imul(x, HASH_X) ^ Math.imul(y, HASH_Y)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
