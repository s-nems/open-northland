import { messages } from '../../i18n/index.js';
import { WINDOW_REGION_TOP } from '../regions.js';
import { GLYPH } from './icons.js';

/** What the strip says: the held building (or paper) in bold, then what to do with it. `raised`
 *  lifts it clear of the central window's head, for a hold the window stays open under. */
export interface PlacementStripView {
  readonly label: string;
  readonly hint: string;
  readonly raised?: boolean;
}

/** The strip at the head of the central region while a building or a paper is held: what is held,
 *  what to do, and that Esc or the right button calls it off. */
export interface PlacementStrip {
  show(view: PlacementStripView): void;
  clear(): void;
  dispose(): void;
}

export function createPlacementStrip(plane: HTMLElement): PlacementStrip {
  const copy = messages().hud.construction;
  const element = document.createElement('div');
  element.className = 'on-strip';
  element.setAttribute('role', 'status');
  element.hidden = true;
  element.style.top = `${WINDOW_REGION_TOP}px`;
  element.innerHTML = `${GLYPH.pin}<span class="on-strip__text"><b></b><span></span></span><span class="on-strip__keys"><kbd class="on-key">Esc</kbd><kbd class="on-key"></kbd><span></span></span>`;
  const label = element.querySelector('b');
  const hint = element.querySelector('.on-strip__text > span');
  const [, rightButton] = element.querySelectorAll('kbd');
  const cancels = element.querySelector('.on-strip__keys > span');
  if (label === null || hint === null || rightButton === undefined || cancels === null) {
    throw new Error('placement strip: markup missing');
  }
  rightButton.textContent = copy.rightButton;
  cancels.textContent = copy.cancels;
  plane.append(element);
  return {
    show: (view) => {
      label.textContent = view.label;
      hint.textContent = ` · ${view.hint}`;
      element.classList.toggle('on-strip--raised', view.raised === true);
      element.hidden = false;
    },
    clear: () => {
      element.hidden = true;
    },
    dispose: () => element.remove(),
  };
}
