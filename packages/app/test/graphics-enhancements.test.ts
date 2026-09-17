import { describe, expect, it } from 'vitest';
import { graphicsEnhancementsFor } from '../src/view/graphics-enhancements.js';
import { pixelArtScalerParam } from '../src/view/params.js';
import { defaultSettings, parseStoredSettings } from '../src/view/settings-store.js';

describe('graphics experiment choices', () => {
  it('keeps each saved choice and ignores malformed flags', () => {
    const settings = parseStoredSettings(
      '{"enhancedSampling":false,"softShadows":false,"environmentMotion":"off"}',
    );
    expect(settings.enhancedSampling).toBe(false);
    expect(settings.softShadows).toBe(false);
    expect(settings.environmentMotion).toBe(true);
    expect(graphicsEnhancementsFor(new URLSearchParams(), settings)).toBe(settings);
  });

  it('reproduces the baseline or a single experiment independently of stored choices', () => {
    const stored = defaultSettings();
    expect(graphicsEnhancementsFor(new URLSearchParams('polish=off'), stored)).toEqual({
      enhancedSampling: false,
      softShadows: false,
      environmentMotion: false,
    });
    expect(graphicsEnhancementsFor(new URLSearchParams('polish=shadows'), stored)).toEqual({
      enhancedSampling: false,
      softShadows: true,
      environmentMotion: false,
    });
  });

  it('reads the pixel-art scaler A/B choice only from a known value', () => {
    expect(pixelArtScalerParam(new URLSearchParams('scaler=sharp'))).toBe('sharp');
    expect(pixelArtScalerParam(new URLSearchParams('scaler=xbr'))).toBe('xbr');
    expect(pixelArtScalerParam(new URLSearchParams('scaler=nearest'))).toBeNull();
    expect(pixelArtScalerParam(new URLSearchParams())).toBeNull();
  });
});
