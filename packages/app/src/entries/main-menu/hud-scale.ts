import { displayViewOf, uiScaleFor } from '../../hud/ui-scale.js';
import { menuSettings } from './settings/state.js';

/** The game's HUD scale for this display and window, with the player's own factor, so a HUD plane on a
 *  menu screen reads at the size it does in game. */
export function menuHudScale(): number {
  return uiScaleFor(displayViewOf(window.innerWidth, window.innerHeight), menuSettings().uiScaleFactor);
}
