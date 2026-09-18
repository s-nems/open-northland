import { DEFAULT_SHADOW_STYLE } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { graphicsEnhancementsFor } from '../src/view/graphics-enhancements.js';
import { pixelArtScalerParam, shadowStyleParam, walkPlacementParam } from '../src/view/params.js';
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

  it('tunes only the shadow fields the URL names, dropping malformed pairs', () => {
    expect(shadowStyleParam(new URLSearchParams())).toBeNull();
    expect(shadowStyleParam(new URLSearchParams('shadows=gain:2.4,tint:ff0000,shear:0.7'))).toEqual({
      ...DEFAULT_SHADOW_STYLE,
      alphaGain: 2.4,
      tint: 0xff0000,
      castShear: 0.7,
    });
    // An out-of-range ceiling, an unparsable number and an unknown key all leave the default.
    expect(shadowStyleParam(new URLSearchParams('shadows=max:2,flatten:none,haze:1'))).toEqual(
      DEFAULT_SHADOW_STYLE,
    );
  });

  it("picks which of a character's two silhouettes draw from the A/B mode", () => {
    const mode = (value: string) => {
      const style = shadowStyleParam(new URLSearchParams(`shadows=mode:${value}`));
      return style === null ? null : [style.cast, style.blob];
    };
    expect(mode('cast')).toEqual([true, false]);
    expect(mode('blob')).toEqual([false, true]);
    expect(mode('both')).toEqual([true, true]);
    expect(mode('neither')).toEqual([DEFAULT_SHADOW_STYLE.cast, DEFAULT_SHADOW_STYLE.blob]);
  });

  it('reads the walk placement choice and drops an unknown one', () => {
    expect(walkPlacementParam(new URLSearchParams())).toBeNull();
    expect(walkPlacementParam(new URLSearchParams('placement=window'))).toBe('window');
    expect(walkPlacementParam(new URLSearchParams('placement=glide'))).toBeNull();
  });
});
