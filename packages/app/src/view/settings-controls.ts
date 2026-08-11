export interface SegChoice<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly title?: string;
}

export interface SegHandle<T extends string> {
  readonly root: HTMLDivElement;
  setActive(id: T): void;
}

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
    for (const [key, button] of buttons) {
      button.classList.toggle('is-active', key === id);
      button.setAttribute('aria-pressed', String(key === id));
    }
  };
  setActive(active);
  return { root, setActive };
}

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

export interface SliderSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onCommit?: (value: number) => void;
  /** Commit while dragging for controls whose result is cheap and judged continuously. */
  readonly live?: boolean;
  readonly disabled?: boolean;
  readonly format?: (value: number) => string;
}

export function sliderControl(label: string, spec: SliderSpec): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'main-menu__settings-slider';
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'main-menu__settings-range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.value);
  input.disabled = spec.disabled === true;
  input.setAttribute('aria-label', label);
  const value = document.createElement('span');
  value.className = 'main-menu__settings-value';
  const paint = (): void => {
    const v = Number(input.value);
    value.textContent = spec.format?.(v) ?? `${Math.round(v * 100)}%`;
    input.style.setProperty('--fill', String(((v - spec.min) / (spec.max - spec.min)) * 100));
  };
  paint();
  input.addEventListener('input', paint);
  const commit = spec.onCommit;
  if (commit !== undefined) {
    input.addEventListener('change', () => commit(Number(input.value)));
    if (spec.live === true) input.addEventListener('input', () => commit(Number(input.value)));
  }
  wrap.append(input, value);
  return wrap;
}

export interface SettingRowOptions {
  readonly tip?: string;
  readonly soon?: { readonly badge: string; readonly tip: string };
}

export function settingRow(label: string, control: HTMLElement, options?: SettingRowOptions): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'main-menu__settings-row';
  const name = document.createElement('span');
  name.className = 'main-menu__settings-label';
  name.textContent = label;
  row.append(name, control);
  if (options?.tip !== undefined) row.dataset.tip = options.tip;
  const soon = options?.soon;
  if (soon !== undefined) {
    row.classList.add('is-coming-soon');
    row.dataset.tip = soon.tip;
    const badge = document.createElement('span');
    badge.className = 'main-menu__badge';
    badge.textContent = soon.badge;
    name.append(badge);
    for (const el of [control, ...control.querySelectorAll('button, input')]) {
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.disabled = true;
    }
  }
  return row;
}
