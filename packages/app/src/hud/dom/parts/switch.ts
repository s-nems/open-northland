import { button, isDisabled, onPress, setAttribute, setDisabled, setTip } from './dom.js';

/** An on/off pill with a knob for a standing setting; `small` for one that depends on the row above. */
export interface Switch {
  readonly element: HTMLButtonElement;
  update(on: boolean, enabled: boolean): void;
}

export function createSwitch(
  label: string,
  tip: string,
  onToggle: (next: boolean) => void,
  small = false,
): Switch {
  const control = button(small ? 'on-switch on-switch--small' : 'on-switch');
  control.setAttribute('role', 'switch');
  control.setAttribute('aria-label', label);
  setTip(control, tip);
  let on = false;
  onPress(control, () => {
    if (!isDisabled(control)) onToggle(!on);
  });
  return {
    element: control,
    update(next, enabled): void {
      on = next;
      setAttribute(control, 'aria-checked', String(next));
      setDisabled(control, !enabled);
    },
  };
}
