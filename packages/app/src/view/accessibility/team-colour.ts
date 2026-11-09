import { enhancePlayerColor } from '../../catalog/player-color.js';
import { onStoredSettingsChange, readStoredSettings } from '../settings/store.js';

/** The live team-colour strength, read from storage once and then kept by the change listener, so a
 *  per-entity colour lookup costs no settings parse. */
let strength: number | undefined;

function liveStrength(): number {
  if (strength === undefined) {
    strength = readStoredSettings().teamColorStrength;
    onStoredSettingsChange((settings) => {
      strength = settings.teamColorStrength;
    });
  }
  return strength;
}

/** A packed team colour as the player's team-colour-strength setting shows it. */
export function teamColour(rgb: number): number {
  return enhancePlayerColor(rgb, liveStrength());
}

/** {@link teamColour} as a CSS hex colour. */
export function teamColourHex(rgb: number): string {
  return `#${teamColour(rgb).toString(16).padStart(6, '0')}`;
}
