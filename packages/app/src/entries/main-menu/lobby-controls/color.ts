import { MAP_PLAYER_COLOR_COUNT } from '@open-northland/data';
import { playerSwatchHex } from '../../../catalog/roster.js';

interface ColorState {
  readonly value: number;
  readonly disabled: boolean;
  readonly unavailable?: (color: number) => boolean;
}
interface ColorOptions {
  readonly label: string;
  readonly name: (color: number) => string;
  readonly change: (color: number) => void;
}
interface ChipState {
  readonly value: number;
  readonly disabled: boolean;
  readonly expanded: boolean;
  /** Appended to the title while the colour cannot be changed. */
  readonly lockedNote?: string;
}
const COLORS = Array.from({ length: MAP_PLAYER_COLOR_COUNT }, (_, color) => color);

/** The seat's colour as a numbered block; clicking it opens or closes the seat's palette. */
export function colorChip(options: Pick<ColorOptions, 'label' | 'name'>, player: number, toggle: () => void) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'main-menu__lobby-chip';
  chip.textContent = String(player + 1);
  chip.dataset.focus = `chip:${player}`;
  chip.addEventListener('click', toggle);
  return {
    root: chip,
    update(state: ChipState): void {
      chip.style.background = playerSwatchHex(state.value);
      const title = `${options.label}: ${options.name(state.value)}`;
      chip.title = state.disabled && state.lockedNote ? `${title} (${state.lockedNote})` : title;
      chip.setAttribute('aria-label', chip.title);
      chip.disabled = state.disabled;
      chip.setAttribute('aria-expanded', String(state.expanded));
    },
  };
}

export function colorPalette(options: ColorOptions, state: ColorState, player: number): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'main-menu__lobby-picker';
  for (const color of COLORS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'main-menu__lobby-swatch';
    option.style.background = playerSwatchHex(color);
    option.title = `${options.label}: ${options.name(color)}`;
    option.setAttribute('aria-label', option.title);
    option.disabled = state.disabled || (color !== state.value && state.unavailable?.(color) === true);
    option.dataset.focus = `swatch:${player}:${color}`;
    option.classList.toggle('is-current', color === state.value);
    option.addEventListener('click', () => options.change(color));
    strip.append(option);
  }
  return strip;
}
