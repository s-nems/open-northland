/** Shared DOM controls of the sub-screens; their CSS lives in menu.css "Controls shared by the
 *  sub-screens". Screens with one-off control needs (the map-select filter tabs) stay bespoke. */

export interface SegChoice<T extends string> {
  readonly id: T;
  readonly label: string;
  /** Optional hover tooltip (e.g. the lobby's fog-mode details). */
  readonly title?: string;
}

export interface SegHandle<T extends string> {
  readonly root: HTMLDivElement;
  /** Repaint which choice reads as active (a pick or an external state change). */
  setActive(id: T): void;
}

/** A joined segmented control. `onPick` owns the reaction; call `setActive` to reflect it. */
export function segControl<T extends string>(
  choices: readonly SegChoice<T>[],
  active: T,
  onPick: (id: T) => void,
): SegHandle<T> {
  const root = document.createElement('div');
  root.className = 'main-menu__seg';
  const buttons = new Map<T, HTMLButtonElement>();
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__seg-btn';
    button.textContent = choice.label;
    if (choice.title !== undefined) button.title = choice.title;
    button.addEventListener('click', () => onPick(choice.id));
    buttons.set(choice.id, button);
    root.append(button);
  }
  const setActive = (id: T): void => {
    for (const [key, button] of buttons) button.classList.toggle('is-active', key === id);
  };
  setActive(active);
  return { root, setActive };
}

/** The 66x34 design pill switch. `titleFor` keeps the hover tooltip in step with the state. */
export function togglePill(
  on: boolean,
  onToggle: (on: boolean) => void,
  titleFor?: (on: boolean) => string,
): HTMLButtonElement {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'main-menu__toggle';
  pill.setAttribute('role', 'switch');
  let state = on;
  const paint = (): void => {
    pill.classList.toggle('is-on', state);
    pill.setAttribute('aria-checked', String(state));
    if (titleFor !== undefined) pill.title = titleFor(state);
  };
  paint();
  pill.addEventListener('click', () => {
    state = !state;
    paint();
    onToggle(state);
  });
  return pill;
}
