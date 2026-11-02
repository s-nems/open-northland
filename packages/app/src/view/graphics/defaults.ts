import type { TierResult } from '@pmndrs/detect-gpu';
import type { MenuSettings } from '../settings/store.js';

export type GraphicsProfile = 'performance' | 'balanced' | 'quality';

type GraphicsDefaults = Pick<
  MenuSettings,
  | 'enhancedSampling'
  | 'pixelArtScaler'
  | 'softShadows'
  | 'enhancedWater'
  | 'environmentMotion'
  | 'groundedBuildings'
  | 'buildingDamage'
  | 'weather'
  | 'dayNight'
  | 'postFxEnabled'
>;

export interface GraphicsRecommendation {
  readonly profile: GraphicsProfile;
  readonly settings: GraphicsDefaults;
}

/** The library's benchmark tiers already account for display size. This mapping is our quality
 * policy, not a promise that its benchmark FPS equals this game's frame rate. */
export function recommendGraphics(result: TierResult): GraphicsRecommendation {
  const benchmark = result.type === 'BENCHMARK';
  const profile: GraphicsProfile =
    benchmark && result.tier === 3 ? 'quality' : benchmark && result.tier === 2 ? 'balanced' : 'performance';
  const effects = profile !== 'performance';
  return {
    profile,
    settings: {
      enhancedSampling: profile === 'quality',
      pixelArtScaler: 'xbr',
      softShadows: effects,
      enhancedWater: effects,
      environmentMotion: effects,
      groundedBuildings: effects,
      buildingDamage: effects,
      weather: effects,
      dayNight: effects,
      postFxEnabled: effects,
    },
  };
}
