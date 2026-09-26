import {
  button,
  element,
  isDisabled,
  removeAttribute,
  setAttribute,
  setDisabled,
  setTip,
  write,
} from './dom.js';

/** One option of a strip: its words, and a refused option faded with the reason in its tooltip. */
export interface SegmentedOption {
  readonly label: string;
  /** False fades the option and ignores its press; the tooltip says why. Absent is true. */
  readonly enabled?: boolean;
  /** The chip's text and the option's accessible name; absent shows none and names it by its label. */
  readonly tooltip?: string;
}

/** What an option shows and says once the strip knows which one is chosen. */
export interface SegmentView {
  readonly text: string;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly tip: string;
  /** The accessible name, or null to let the label name the option. */
  readonly ariaLabel: string | null;
}

export function segmentView(option: SegmentedOption, chosen: boolean): SegmentView {
  const tip = option.tooltip ?? '';
  return {
    text: option.label,
    pressed: chosen,
    disabled: option.enabled === false,
    tip,
    ariaLabel: tip === '' ? null : tip,
  };
}

/** A press picks only a live option that is not already the chosen one. */
export function segmentPicks(pressed: boolean, disabled: boolean): boolean {
  return !pressed && !disabled;
}

/** A few mutually exclusive choices in one strip, the chosen one lit. */
export interface Segmented<K extends string> {
  readonly element: HTMLElement;
  /** Relabel the options and light `chosen` (null lights none); `groupLabel` renames the strip. */
  update(options: Readonly<Record<K, SegmentedOption>>, chosen: K | null, groupLabel?: string): void;
}

export function createSegmented<K extends string>(
  keys: readonly K[],
  groupLabel: string,
  onPick: (key: K) => void,
): Segmented<K> {
  const root = element('span', 'on-segmented');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', groupLabel);
  const options = keys.map((key) => {
    const option = button('');
    option.addEventListener('click', () => {
      if (segmentPicks(option.getAttribute('aria-pressed') === 'true', isDisabled(option))) onPick(key);
    });
    root.append(option);
    return { key, option };
  });
  return {
    element: root,
    update(models, chosen, label): void {
      if (label !== undefined) setAttribute(root, 'aria-label', label);
      for (const { key, option } of options) {
        const view = segmentView(models[key], key === chosen);
        write(option, view.text);
        setAttribute(option, 'aria-pressed', String(view.pressed));
        setDisabled(option, view.disabled);
        setTip(option, view.tip);
        if (view.ariaLabel === null) removeAttribute(option, 'aria-label');
        else setAttribute(option, 'aria-label', view.ariaLabel);
      }
    },
  };
}
