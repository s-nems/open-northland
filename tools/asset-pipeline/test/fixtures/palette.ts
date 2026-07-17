/**
 * Shared synthetic palette fixtures. No copyrighted bytes: these builders synthesize the tiny palette
 * carriers the decoders round-trip against, so specs across the pipeline share one definition.
 */

/** A 768-byte palette where entry i is (i, 255-i, (i*7) & 0xff) — every channel varies with the index. */
export const rampPalette = (): Uint8Array => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = 255 - i;
    p[i * 3 + 2] = (i * 7) & 0xff;
  }
  return p;
};

/** A 768-byte palette with every entry set to one RGB triple. */
export const solidPalette = (r: number, g: number, b: number): Uint8Array => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = r;
    p[i * 3 + 1] = g;
    p[i * 3 + 2] = b;
  }
  return p;
};
