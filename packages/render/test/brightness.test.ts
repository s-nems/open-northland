import { describe, expect, it } from 'vitest';
import { scaleColour } from '../src/data/brightness.js';
import { padLaneRows } from '../src/gpu/shading.js';
import { BRIGHTNESS_NEUTRAL, makeBrightnessField } from '../src/index.js';

/**
 * Headless tests for the terrain-brightness seam (`data/brightness.ts`) — the decoded `embr` lane as
 * the ground's shading multiplier. Pixels are human-gated; what is agent-checkable is the measured
 * response curve's mapping (value/127, UNCLAMPED above 1 — the lane brightens as well as darkens)
 * and the neutral no-lane path (multiplier 1, `shaded` false — the byte-identical unshaded mesh).
 * The mesh-vertex lane coordinates live with the tessellation (`terrain.test.ts` `nodeLaneUV`).
 */

describe('makeBrightnessField.brightnessAt', () => {
  // 3×2 grid, row-major: row0 = [0, 127, 254], row1 = [127, 127, 127].
  const field = makeBrightnessField([0, 127, 254, 127, 127, 127], 3, 2);

  it('maps the lane through the measured curve: value/127 (0 → black, 127 → 1, 254 → 2×)', () => {
    expect(field.shaded).toBe(true);
    expect(field.brightnessAt(0, 0)).toBe(0);
    expect(field.brightnessAt(1, 0)).toBe(1);
    expect(field.brightnessAt(2, 0)).toBeCloseTo(254 / BRIGHTNESS_NEUTRAL, 6); // 2.0 — NOT clamped at 1
  });

  it('bilinearly interpolates fractional positions (the border fade ramps across the last cells)', () => {
    // Halfway between col 0 (0) and col 1 (127) → 63.5/127 = 0.5 — the smooth edge fade.
    expect(field.brightnessAt(0.5, 0)).toBeCloseTo(0.5, 6);
    // Down a column: halfway between (0,0)=0 and (0,1)=127 → 0.5.
    expect(field.brightnessAt(0, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('clamps to the map edge (a sample past an edge repeats the boundary cell)', () => {
    expect(field.brightnessAt(-1, 0)).toBe(field.brightnessAt(0, 0));
    expect(field.brightnessAt(5, 1)).toBe(field.brightnessAt(2, 1));
  });

  it('is NEUTRAL (multiplier 1, shaded false) without a lane — the byte-identical unshaded path', () => {
    for (const neutral of [
      makeBrightnessField(undefined, 3, 2),
      makeBrightnessField([], 3, 2),
      makeBrightnessField([127], 0, 0),
    ]) {
      expect(neutral.shaded).toBe(false);
      expect(neutral.brightnessAt(1.5, 0.5)).toBe(1);
    }
  });
});

describe('scaleColour — the flat-fallback CPU twin of the shader multiply', () => {
  it('scales each channel and clamps at white (the >1 brighten saturates, never wraps)', () => {
    expect(scaleColour(0x804020, 1)).toBe(0x804020); // neutral: untouched (identity fast path)
    expect(scaleColour(0x804020, 0)).toBe(0x000000); // the border fade
    expect(scaleColour(0x804020, 0.5)).toBe(0x402010);
    expect(scaleColour(0x804020, 2)).toBe(0xff8040); // 0x80×2 clamps to 0xff
  });
});

describe('padLaneRows — the R8 upload alignment padding', () => {
  it('pads each row to the alignment by replicating the last column (clamp-preserving)', () => {
    // 3-wide lane, alignment 4: each row gains one replica of its last value — an unpadded upload
    // would shear under WebGL's default UNPACK_ALIGNMENT of 4 (the observed corruption).
    const { data, paddedWidth } = padLaneRows([1, 2, 3, 4, 5, 6], 3, 2, 4);
    expect(paddedWidth).toBe(4);
    expect([...data]).toEqual([1, 2, 3, 3, 4, 5, 6, 6]);
  });

  it('is the identity layout for an already-aligned width', () => {
    const { data, paddedWidth } = padLaneRows([9, 8, 7, 6], 4, 1, 4);
    expect(paddedWidth).toBe(4);
    expect([...data]).toEqual([9, 8, 7, 6]);
  });
});
