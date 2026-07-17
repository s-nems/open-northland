import { encodePcx } from '../../src/decoders/pcx.js';
import { rampPalette } from './palette.js';

/**
 * A small indexed picture (mixes runs and an escaped >= 0xC0 value), encoded with its palette. Pass a
 * `palette` to make two carriers distinguishable — the default ramp is shared, so two `samplePcx()`
 * files are byte-identical and cannot prove which one a decoder read.
 */
export const samplePcx = (
  palette: Uint8Array = rampPalette(),
): { bytes: Uint8Array; width: number; height: number } => {
  const width = 4;
  const height = 3;
  const pixels = Uint8Array.from([0, 0, 1, 200, 5, 5, 5, 5, 9, 0, 9, 0]);
  return { bytes: encodePcx({ width, height, pixels, palette }), width, height };
};

/** A 2×2 palette carrier (the shape the real `Data/gui/palettes/*.pcx` are: tiny image, 256-colour trailer). */
export const paletteCarrier = (): Uint8Array =>
  encodePcx({ width: 2, height: 2, pixels: Uint8Array.from([0, 1, 2, 3]), palette: rampPalette() });
