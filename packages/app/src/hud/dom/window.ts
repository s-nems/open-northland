import { GLYPH } from './icons.js';
import { WINDOW_ORNAMENTS } from './symbols.js';

export interface HudWindowSpec {
  readonly title: string;
  /** Small-caps line above the title (the selection panel's "ZAZNACZENIE"). */
  readonly kicker?: string;
  readonly subtitle?: string;
  /** Markup placed left of the title, such as a painted icon. */
  readonly art?: string;
  readonly closeLabel: string;
  /** Design px; the height follows the body. */
  readonly width: number;
  readonly compact?: boolean;
}

/** A framed window on the DOM plane: wood rails, knot ornaments, a head with a close medallion and a
 *  body the owner fills. Placement is the owner's: `place` takes design px. */
export interface HudWindow {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  place(x: number, y: number): void;
  /** Runs after every close, from the medallion or the owner; the owner returns focus. */
  onClose(listener: () => void): void;
  dispose(): void;
}

export function createHudWindow(plane: HTMLElement, spec: HudWindowSpec): HudWindow {
  const element = document.createElement('section');
  element.className = 'on-window on-panel';
  element.hidden = true;
  element.style.width = `${spec.width}px`;
  element.setAttribute('aria-label', spec.title);
  const compact = spec.compact === true;
  element.innerHTML = `${WINDOW_ORNAMENTS}<header class="on-window__head${compact ? ' on-window__head--compact' : ''}"><div class="on-window__heading">${spec.art ?? ''}<div>${
    spec.kicker === undefined ? '' : `<p class="on-window__kicker"></p>`
  }<h2 class="on-window__title${compact ? ' on-window__title--compact' : ''}"></h2>${
    spec.subtitle === undefined ? '' : `<p class="on-window__subtitle"></p>`
  }</div></div><button type="button" class="on-medallion on-window__close">${GLYPH.close}</button></header><div class="on-window__body"></div>`;
  const text = (selector: string, value: string | undefined): void => {
    const node = element.querySelector(selector);
    if (node !== null && value !== undefined) node.textContent = value;
  };
  text('.on-window__title', spec.title);
  text('.on-window__kicker', spec.kicker);
  text('.on-window__subtitle', spec.subtitle);
  const closeButton = element.querySelector('button');
  if (closeButton === null) throw new Error('hud window: close button missing');
  closeButton.setAttribute('aria-label', spec.closeLabel);
  const body = element.querySelector('.on-window__body');
  if (!(body instanceof HTMLElement)) throw new Error('hud window: body missing');
  const listeners: (() => void)[] = [];
  const close = (): void => {
    if (element.hidden) return;
    element.hidden = true;
    for (const listener of listeners) listener();
  };
  closeButton.addEventListener('click', close);
  plane.append(element);
  return {
    element,
    body,
    isOpen: () => !element.hidden,
    open: () => {
      element.hidden = false;
    },
    close,
    place: (x, y) => {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    },
    onClose: (listener) => {
      listeners.push(listener);
    },
    dispose: () => element.remove(),
  };
}
