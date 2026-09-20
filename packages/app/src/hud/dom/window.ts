import { minimapDesignBox } from '../minimap/model.js';
import { centralWindowBox } from '../regions.js';
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
  /** Close as the medallion does, telling the dismiss listeners. */
  dismiss(): void;
  place(x: number, y: number): void;
  /** Runs when the close medallion closed the window, so the owner can return focus; a close the
   *  owner made itself (another window replacing this one) stays silent. */
  onDismiss(listener: () => void): void;
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
    element.hidden = true;
  };
  const dismiss = (): void => {
    close();
    for (const listener of listeners) listener();
  };
  closeButton.addEventListener('click', dismiss);
  plane.append(element);
  return {
    element,
    body,
    isOpen: () => !element.hidden,
    open: () => {
      element.hidden = false;
    },
    close,
    dismiss,
    place: (x, y) => {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    },
    onDismiss: (listener) => {
      listeners.push(listener);
    },
    dispose: () => element.remove(),
  };
}

/**
 * The one placement every central window uses, applied only when the box moved. The caller runs it
 * per frame and on open; it answers whether the window moved, for an owner that repaints against the
 * new box.
 */
export function centralWindowPlacer(window: HudWindow, plane: HTMLElement, width: number): () => boolean {
  let placed = '';
  return () => {
    if (!window.isOpen()) return false;
    // The plane's client box is the design-px screen (foundation.css sizes it by 1 / scale).
    const screen = { width: plane.clientWidth, height: plane.clientHeight };
    const box = centralWindowBox(screen, 1, width, minimapDesignBox(screen.height));
    const key = `${box.x},${box.y},${box.maxHeight}`;
    if (key === placed) return false;
    placed = key;
    window.place(box.x, box.y);
    window.element.style.maxHeight = `${box.maxHeight}px`;
    return true;
  };
}
