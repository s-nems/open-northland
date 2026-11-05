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

  it.each([
    [
      'a two-unit Raphael',
      'ANGLE (AMD, AMD Radeon(TM) Graphics (0x0000164E) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'balanced',
    ],
    [
      'a two-unit Mendocino',
      'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001506) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'balanced',
    ],
    [
      'a seven-unit Renoir',
      'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001636) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'quality',
    ],
    ['a Radeon without a device id', 'AMD Radeon(TM) Graphics', 'quality'],
    [
      'a named discrete card',
      'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'quality',
    ],
  ] as const)(
    'caps the tier 3 profile of %s at Balanced only for a two-unit device id',
    (_, renderer, profile) => {
      const result = recommendGraphics({ type: 'BENCHMARK', tier: 3 }, renderer);
      expect(result).toMatchObject({ profile, cap: profile === 'balanced' ? 'two-unit-radeon' : null });
      if (profile === 'balanced') {
        expect(result.settings).toEqual(recommendGraphics({ type: 'BENCHMARK', tier: 2 }).settings);
      }
    },
  );

  it('never raises a lower tier for a two-unit device id', () => {
    const renderer = 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x0000164E) Direct3D11 vs_5_0 ps_5_0, D3D11)';
    expect(recommendGraphics({ type: 'BENCHMARK', tier: 1 }, renderer)).toMatchObject({
      profile: 'performance',
      cap: null,
    });
    expect(recommendGraphics({ type: 'FALLBACK', tier: 3 }, renderer).profile).toBe('performance');
  });
});
