/** A `Uint8Array` from explicit byte values — the terse builder for hand-built byte runs in fixtures. */
export const bytesOf = (...vals: number[]): Uint8Array => Uint8Array.from(vals);

/** Little-endian u32 as 4 bytes — the byte order every Cultures container stores integers in. */
export const le32 = (v: number): number[] => [
  v & 0xff,
  (v >>> 8) & 0xff,
  (v >>> 16) & 0xff,
  (v >>> 24) & 0xff,
];
