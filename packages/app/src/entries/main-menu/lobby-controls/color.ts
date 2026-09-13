import { MAP_PLAYER_COLOR_COUNT } from '@open-northland/data';
import { playerSwatchHex } from '../../../catalog/roster.js';
import { selectControl } from './select.js';

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
const COLORS = Array.from({ length: MAP_PLAYER_COLOR_COUNT }, (_, color) => color);

export function colorSelect(options: ColorOptions, className: string) {
  const control = selectControl(
    options.label,
    COLORS.map((color) => [String(color), options.name(color)] as const),
    (value) => options.change(Number(value)),
    className,
  );
  return {
    root: control.root,
    update(state: ColorState): void {
      control.update(String(state.value), state.disabled);
      control.input.style.borderInlineStart = `6px solid ${playerSwatchHex(state.value)}`;
      for (const option of control.input.options)
        option.disabled =
          state.unavailable?.(Number(option.value)) === true && Number(option.value) !== state.value;
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
