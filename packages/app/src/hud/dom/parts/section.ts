import { element, write } from './dom.js';

/** A small-caps section title with its rule, and an optional control at the rule's right end (an add
 *  button, a fold toggle) that costs the section no row of its own. */
export interface Section {
  readonly element: HTMLElement;
  update(title: string): void;
}

export function createSection(control?: HTMLElement): Section {
  const root = element('div', 'on-section', '<span></span>');
  const title = root.firstElementChild;
  if (title === null) throw new Error('section: title');
  if (control !== undefined) {
    control.classList.add('on-section__control');
    root.append(control);
  }
  return { element: root, update: (text) => write(title, text) };
}
