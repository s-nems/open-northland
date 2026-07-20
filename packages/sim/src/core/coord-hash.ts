/**
 * A deterministic 32-bit hash of an integer grid coordinate pair — the sim's way to derive stable
 * per-location variation WITHOUT touching `world.rng`. Drawing such variation from the seeded RNG would
 * couple it to the command stream (a different command order would shift every later draw), so anything
 * keyed by *where* it happened hashes the place instead and stays byte-stable across runs and replays.
 *
 * The mixers are the usual golden-ratio / murmur3 odd constants; any fixed odd pair serves — the hash
 * only has to be deterministic and spatially uncorrelated, never cryptographic.
 */
const HASH_X = 0x9e3779b1;
const HASH_Y = 0x85ebca6b;

export function coordHash(x: number, y: number): number {
  return (Math.imul(x, HASH_X) ^ Math.imul(y, HASH_Y)) >>> 0;
}
