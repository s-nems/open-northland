import { diag } from '../../diag/log.js';
import { defaultSettings, initializeStoredSettings, type MenuSettings } from '../settings/store.js';
import { recommendGraphics } from './defaults.js';
import { detectGraphicsTier } from './tier.js';

/** Also used by the player's explicit restore-defaults action; never by a live frame loop. */
export async function recommendedSettings(): Promise<MenuSettings> {
  const detection = await detectGraphicsTier();
  const recommendation = recommendGraphics(detection.result, detection.renderer);
  diag.info('boot', 'graphics defaults selected', { ...detection, ...recommendation });
  return { ...defaultSettings(), ...recommendation.settings };
}

export function initializeGraphicsSettings(): Promise<void> {
  return initializeStoredSettings(recommendedSettings);
}
