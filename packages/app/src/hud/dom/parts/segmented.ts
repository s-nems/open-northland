import { button, element, setAttribute, write } from './dom.js';

/** A few mutually exclusive choices in one strip, the chosen one lit. */
export interface Segmented<K extends string> {
  readonly element: HTMLElement;
  /** Relabel the options and light `chosen` (null lights none). */
  update(labels: Readonly<Record<K, string>>, chosen: K | null): void;
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
      if (option.getAttribute('aria-pressed') !== 'true') onPick(key);
    });
    root.append(option);
    return { key, option };
  });
  return {
    element: root,
    update(labels, chosen): void {
      for (const { key, option } of options) {
        write(option, labels[key]);
        setAttribute(option, 'aria-pressed', String(key === chosen));
      }
    },
  };
}
