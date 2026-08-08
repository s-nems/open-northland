/** FNV-1a 32-bit primitives: the one word-mixing scheme every state digest shares. */

export const FNV_OFFSET_BASIS = 2166136261 >>> 0;
const FNV_PRIME = 16777619;

/** One FNV-1a step: fold a 32-bit word into the running hash. */
export function fnvMixWord(h: number, word: number): number {
  return Math.imul(h ^ (word | 0), FNV_PRIME) >>> 0;
}

/** The running hash in its canonical 8-hex-digit form. */
export function fnvHex(h: number): string {
  return h.toString(16).padStart(8, '0');
}
