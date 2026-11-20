import { describe, expect, it } from 'vitest';
import { WORLD_MAGNIFY_MODES } from '../../../src/gpu/pixel-art/registry.js';
import {
  WORLD_FLAG_MIPMAPPED,
  WORLD_FLAG_RECOLOURED,
  WORLD_LUT_ROW_SHIFT,
  worldBatchFragment,
} from '../../../src/gpu/world-batch/shader.js';

const SLOTS = 16;

describe('world batch sampling', () => {
  it('leaves xBR and its twelve-tap window out of the unmagnified program', () => {
    const magnifying = worldBatchFragment(16, WORLD_MAGNIFY_MODES.xbr, null, 'magnifying');
    const unmagnified = worldBatchFragment(16, WORLD_MAGNIFY_MODES.xbr, null, 'unmagnified');
    for (const wide of ['magnifyXbrCorner(n,', 'taps[XBR_TAPS]']) {
      expect(magnifying).toContain(wide);
      expect(unmagnified).not.toContain(wide);
    }
  });
});

describe('world batch program, recoloured elements', () => {
  const programs = (['magnifying', 'unmagnified'] as const).map((sampling) =>
    worldBatchFragment(SLOTS, WORLD_MAGNIFY_MODES.xbr, null, sampling),
  );

  it('keeps the row above every flag bit', () => {
    expect(WORLD_FLAG_RECOLOURED).toBeGreaterThan(WORLD_FLAG_MIPMAPPED);
    expect(1 << WORLD_LUT_ROW_SHIFT).toBeGreaterThan(WORLD_FLAG_RECOLOURED);
  });

  it('premultiplies a recoloured texel in bytes, round(c * a / 255), in both programs', () => {
    for (const fragment of programs) {
      expect(fragment).toContain('(bytes * coverage + BYTE_ROUNDING_BIAS) / BYTE_MAX');
    }
  });

  it("samples through the plain page's path, resolving minification taps before they blend", () => {
    for (const fragment of programs) {
      expect(fragment).toContain('bool palettedFilter = paletted && !recoloured;');
      expect(fragment).toContain('(palettedFilter || hasFlag(flags, WORLD_FLAG_MAGNIFY))');
      expect(fragment).toContain('bool minified = filtered && !palettedFilter && !magnified;');
      expect(fragment).toContain('recolouredTexel(t0, lutRow)');
    }
  });

  it('magnifies a recoloured element through xBR in the prescaled program, which has no twin for it', () => {
    const prescaled = worldBatchFragment(SLOTS, WORLD_MAGNIFY_MODES.prescaled, null, 'magnifying');
    expect(prescaled).toContain('bool xbr = magnified && (WORLD_MAGNIFY == MAGNIFY_XBR || paletted);');
  });
});
