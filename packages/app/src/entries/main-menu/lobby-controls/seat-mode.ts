import { segControl } from '../../../view/settings-controls.js';
import { selectControl } from './select.js';

type SeatMode = 'ai' | 'idle' | 'human';
interface ModeOptions {
  readonly fieldClassName?: string;
  readonly label: string;
  readonly choices: readonly { readonly id: SeatMode; readonly label: string; readonly disabled?: boolean }[];
  readonly change: (mode: SeatMode) => void;
}

export function seatModeControl(options: ModeOptions, presentation: 'select' | 'segments') {
  let current: SeatMode = 'idle';
  const change = (mode: string): void => {
    const choice = options.choices.find((choice) => choice.id === mode);
    if (choice && !choice.disabled && choice.id !== current) options.change(choice.id);
  };
  if (presentation === 'select') {
    const control = selectControl(
      options.label,
      options.choices.map(({ id, label }) => [id, label]),
      change,
      options.fieldClassName,
    );
    return {
      root: control.root,
      update(value: SeatMode, disabled: boolean): void {
        current = value;
        control.update(value, disabled);
        for (const option of control.input.options)
          option.disabled = options.choices.find((choice) => choice.id === option.value)?.disabled === true;
      },
    };
  }
  const control = segControl(options.choices, current, change);
  control.root.setAttribute('aria-label', options.label);
  return {
    root: control.root,
    update(value: SeatMode, disabled: boolean): void {
      current = value;
      control.setActive(value);
      for (const [index, button] of [...control.root.querySelectorAll('button')].entries())
        button.disabled = disabled || options.choices[index]?.disabled === true;
    },
  };
}
