import type { DetailMode, WorldEnhancements } from '@open-northland/render';

/** One entry per enhancement field, so a field added to the renderer type fails to compile here. */
const ENHANCEMENT_FIELDS: Readonly<Record<keyof WorldEnhancements, true>> = {
  enhancedSampling: true,
  pixelArtScaler: true,
  softShadows: true,
  enhancedWater: true,
  environmentMotion: true,
  groundedBuildings: true,
  buildingDamage: true,
  dayNight: true,
  occlusionFill: true,
  occlusionOutline: true,
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
    groundedBuildings: settings.groundedBuildings,
    buildingDamage: settings.buildingDamage,
    dayNight: settings.dayNight,
    occlusionFill: settings.occlusionFill,
    occlusionOutline: settings.occlusionOutline,
  };
}

/** The renderer's detail mode under the player's distant-detail setting. */
export function detailModeOf(distantDetail: boolean): DetailMode {
  return distantDetail ? 'full' : 'automatic';
}

/** The enhancements a mounted game draws: while the HUD chrome hides, the ghost marks stay off, so a
 *  screenshot or a recording gets the plain world. The stored settings keep their values. */
export function drawnEnhancementsOf(settings: WorldEnhancements, chromeHidden: boolean): WorldEnhancements {
  return chromeHidden ? { ...settings, occlusionFill: false, occlusionOutline: false } : settings;
}
