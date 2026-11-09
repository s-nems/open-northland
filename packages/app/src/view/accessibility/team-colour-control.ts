import {
  enhancePlayerColor,
  TEAM_COLOR_STRENGTH_MAX,
  TEAM_COLOR_STRENGTH_MIN,
} from '../../catalog/player-color.js';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { sliderControl } from '../settings/controls.js';

/** The preview shows the original's ten player colours; the later slots are this project's additions. */
const PREVIEW_SWATCH_COUNT = 10;

/** The team-colour-strength slider with a strip of player colours under it that follows the knob. The
 *  strip also passes through the screen-wide colour-blind filter, so it previews both settings. */
export function teamColourStrengthControl(
  label: string,
  value: number,
  onCommit: (value: number) => void,
): HTMLDivElement {
  const slider = sliderControl(label, {
    min: TEAM_COLOR_STRENGTH_MIN,
    max: TEAM_COLOR_STRENGTH_MAX,
    step: 1,
    value,
    live: true,
    onCommit,
    format: String,
  });
  const strip = document.createElement('div');
  strip.className = 'main-menu__team-swatches';
  strip.setAttribute('aria-hidden', 'true');
  const swatches = PLAYER_SWATCH_COLORS.slice(0, PREVIEW_SWATCH_COUNT).map((rgb) => {
    const swatch = document.createElement('span');
    swatch.className = 'main-menu__team-swatch';
    strip.append(swatch);
    return { rgb, swatch };
  });
  const paint = (strength: number): void => {
    for (const { rgb, swatch } of swatches) {
      swatch.style.backgroundColor = `#${enhancePlayerColor(rgb, strength).toString(16).padStart(6, '0')}`;
    }
  };
  paint(value);
  const input = slider.querySelector<HTMLInputElement>('input[type="range"]');
  input?.addEventListener('input', () => paint(Number(input.value)));
  const stack = document.createElement('div');
  stack.className = 'main-menu__settings-stack';
  stack.append(slider, strip);
  return stack;
}
