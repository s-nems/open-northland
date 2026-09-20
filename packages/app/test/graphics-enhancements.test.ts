import { describe, expect, it } from 'vitest';
import { enhancementsOf } from '../src/view/graphics-enhancements.js';
import { defaultSettings, parseStoredSettings } from '../src/view/settings-store.js';

describe('graphics enhancement choices', () => {
  it('keeps each saved choice and ignores malformed values', () => {
    const settings = parseStoredSettings(
      '{"enhancedSampling":false,"pixelArtScaler":"nearest","softShadows":false,"enhancedWater":false,"environmentMotion":"off"}',
    );
    expect(enhancementsOf(settings)).toEqual({
      enhancedSampling: false,
      pixelArtScaler: defaultSettings().pixelArtScaler,
      softShadows: false,
      enhancedWater: false,
      environmentMotion: true,
    });
  });

  it('keeps a known pixel-art filter', () => {
    expect(parseStoredSettings('{"pixelArtScaler":"sharp"}').pixelArtScaler).toBe('sharp');
  });
});
