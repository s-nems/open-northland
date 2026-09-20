import { centralWindowPlacer, createHudWindow, type HudWindow } from '../dom/window.js';
import type { ToolWindow } from './window-shell.js';

/** Width of a pending note window, design px: the central window width of the reference. */
const PENDING_WINDOW_W = 540;

export interface PendingWindowSpec {
  readonly title: string;
  readonly art: string;
  readonly kicker: string;
  readonly text: string;
  readonly closeLabel: string;
}

/** A central window on the DOM plane whose contents are still owned by a later ticket: the framed
 *  head with the entry's icon and a note saying so. It takes part in the window registry like a
 *  legacy pop-up, but the plane routes its own pointer input, so it claims no canvas point. */
export interface PendingWindow extends ToolWindow {
  /** Re-place an open window against the plane's design-px size; call once per frame. */
  place(): void;
  /** The close medallion was pressed; the owner returns focus to the beam. */
  onDismiss(listener: () => void): void;
  dispose(): void;
}

export function createPendingWindow(plane: HTMLElement, spec: PendingWindowSpec): PendingWindow {
  const window: HudWindow = createHudWindow(plane, {
    title: spec.title,
    kicker: spec.kicker,
    art: spec.art,
    closeLabel: spec.closeLabel,
    width: PENDING_WINDOW_W,
  });
  const note = document.createElement('p');
  note.className = 'on-window__subtitle';
  note.style.fontSize = '14px';
  note.textContent = spec.text;
  window.body.append(note);
  const placeWindow = centralWindowPlacer(window, plane, PENDING_WINDOW_W);
  return {
    isOpen: window.isOpen,
    toggle: () => (window.isOpen() ? window.close() : window.open()),
    close: window.close,
    claims: () => false,
    handleClick: () => false,
    place: placeWindow,
    onDismiss: window.onDismiss,
    dispose: window.dispose,
  };
}
