import type { WorldEnhancements } from '@open-northland/render';

/** One entry per enhancement field, so a field added to the renderer type fails to compile here. */
const ENHANCEMENT_FIELDS: Readonly<Record<keyof WorldEnhancements, true>> = {
  enhancedSampling: true,
  pixelArtScaler: true,
  softShadows: true,
  enhancedWater: true,
  environmentMotion: true,
};

/** Every enhancement the Graphics settings own. */
export const ENHANCEMENT_KEYS = Object.keys(ENHANCEMENT_FIELDS) as readonly (keyof WorldEnhancements)[];

/** Only the enhancement fields of a wider settings object. */
export function enhancementsOf(settings: WorldEnhancements): WorldEnhancements {
  return {
    enhancedSampling: settings.enhancedSampling,
    pixelArtScaler: settings.pixelArtScaler,
    softShadows: settings.softShadows,
    enhancedWater: settings.enhancedWater,
    environmentMotion: settings.environmentMotion,
  };
}
