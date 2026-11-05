import type { TierType } from '@pmndrs/detect-gpu';
import { describe, expect, it } from 'vitest';
import { recommendGraphics } from '../../../src/view/graphics/defaults.js';

describe('first-launch graphics policy', () => {
  it('enables every quality enhancement for benchmark tier 3', () => {
    const result = recommendGraphics({ type: 'BENCHMARK', tier: 3 });
    expect(result.profile).toBe('quality');
    expect(result.settings).toEqual({
      enhancedSampling: true,
      pixelArtScaler: 'xbr',
      softShadows: true,
      enhancedWater: true,
      environmentMotion: true,
      groundedBuildings: true,
      buildingDamage: true,
      dayNight: true,
      weather: true,
      postFxEnabled: true,
    });
  });

  it('keeps the effects but disables filtering for benchmark tier 2', () => {
    const result = recommendGraphics({ type: 'BENCHMARK', tier: 2 });
    expect(result.profile).toBe('balanced');
    expect(result.settings).toEqual({
      ...recommendGraphics({ type: 'BENCHMARK', tier: 3 }).settings,
      enhancedSampling: false,
    });
  });

  it.each([0, 1])('uses the performance profile for benchmark tier %i', (tier) => {
    const result = recommendGraphics({ type: 'BENCHMARK', tier });
    expect(result.profile).toBe('performance');
    expect(result.settings).toEqual({
      enhancedSampling: false,
      pixelArtScaler: 'xbr',
      softShadows: false,
      enhancedWater: false,
      environmentMotion: false,
      groundedBuildings: false,
      buildingDamage: false,
      dayNight: false,
      weather: false,
      postFxEnabled: false,
    });
  });

  it.each<TierType>(['FALLBACK', 'BENCHMARK_FETCH_FAILED', 'BLOCKLISTED', 'WEBGL_UNSUPPORTED', 'SSR'])(
    'does not treat %s as a measured hardware tier',
    (type) => {
      expect(recommendGraphics({ type, tier: 3 }).profile).toBe('performance');
    },
  );

  it.each([-1, 4, Number.NaN])('uses conservative defaults for an unsupported tier %s', (tier) => {
    expect(recommendGraphics({ type: 'BENCHMARK', tier }).profile).toBe('performance');
  });
});
