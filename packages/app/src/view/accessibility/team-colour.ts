import { enhancePlayerColor } from '../../catalog/player-color.js';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { onStoredSettingsChange, readStoredSettings } from '../settings/store.js';

/** The live team-colour strength, read from storage once and then kept by the change listener, so a
 *  per-entity colour lookup costs no settings parse. */
let strength: number | undefined;
/** Bumped on each strength change, so a surface that holds painted colours knows to repaint. */
let version = 0;

function liveStrength(): number {
  if (strength === undefined) {
    strength = readStoredSettings().teamColorStrength;
    onStoredSettingsChange((settings) => {
      if (settings.teamColorStrength === strength) return;
      strength = settings.teamColorStrength;
      version++;
    });
  }
  return strength;
}

/** Changes whenever the team-colour strength does. */
export function teamColourVersion(): number {
  liveStrength();
  return version;
}

/** A packed team colour as the player's team-colour-strength setting shows it. */
export function teamColour(rgb: number): number {
  return enhancePlayerColor(rgb, liveStrength());
}

/** A colour slot's swatch through {@link teamColour}; an unknown slot is black. */
export function teamSwatch(slot: number): number {
  return teamColour(PLAYER_SWATCH_COLORS[slot] ?? 0);
}

/** {@link teamSwatch} as a CSS hex colour. */
export function teamSwatchHex(slot: number): string {
  return `#${teamSwatch(slot).toString(16).padStart(6, '0')}`;
}
