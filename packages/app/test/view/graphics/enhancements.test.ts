import { describe, expect, it } from 'vitest';
import { drawnEnhancementsOf, enhancementsOf } from '../../../src/view/graphics/enhancements.js';
import { defaultSettings, parseStoredSettings } from '../../../src/view/settings/store.js';

describe('graphics enhancement choices', () => {
  it('keeps each saved choice and ignores malformed values', () => {
    const settings = parseStoredSettings(
      '{"enhancedSampling":false,"pixelArtScaler":"nearest","softShadows":false,"enhancedWater":false,"environmentMotion":"off","groundedBuildings":false,"occlusionFill":false,"occlusionOutline":false}',
    );
    expect(enhancementsOf(settings)).toEqual({
      enhancedSampling: false,
      pixelArtScaler: defaultSettings().pixelArtScaler,
      softShadows: false,
      enhancedWater: false,
      environmentMotion: true,
      groundedBuildings: false,
      buildingDamage: true,
      dayNight: true,
      occlusionFill: false,
      occlusionOutline: false,
    });
  });

  it('defaults the hidden-unit fill and outline on and persists each disabled choice', () => {
    expect(defaultSettings().occlusionFill).toBe(true);
    expect(defaultSettings().occlusionOutline).toBe(true);
    const neither = enhancementsOf(parseStoredSettings('{"occlusionFill":false,"occlusionOutline":false}'));
    expect(neither.occlusionFill).toBe(false);
    expect(neither.occlusionOutline).toBe(false);
    expect(parseStoredSettings('{"occlusionFill":"yes"}').occlusionFill).toBe(true);
  });

  it('hides the ghost marks with the chrome, keeping every other enhancement', () => {
    const settings = enhancementsOf(defaultSettings());
    expect(drawnEnhancementsOf(settings, false)).toBe(settings);
    expect(drawnEnhancementsOf(settings, true)).toEqual({
      ...settings,
      occlusionFill: false,
      occlusionOutline: false,
    });
  });

  it('defaults structural damage on and persists a disabled choice', () => {
    expect(defaultSettings().buildingDamage).toBe(true);
    expect(enhancementsOf(parseStoredSettings('{"buildingDamage":false}')).buildingDamage).toBe(false);
  });

  it('keeps a known pixel-art filter and reads a retired one as the default', () => {
    expect(parseStoredSettings('{"pixelArtScaler":"xbrz"}').pixelArtScaler).toBe('xbrz');
    for (const retired of ['sharp', 'bilinear'])
      expect(parseStoredSettings(`{"pixelArtScaler":"${retired}"}`).pixelArtScaler).toBe(
        defaultSettings().pixelArtScaler,
      );
  });
});
