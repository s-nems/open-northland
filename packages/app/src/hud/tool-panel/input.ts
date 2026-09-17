import type { UiCue } from '@open-northland/audio';
import { isActionHotkey, isTypingTarget } from '../hotkeys.js';
import type { KeyBindings } from '../keybindings.js';
import type { ToolWindows } from './windows.js';

/** Every branch here that consumes a press stops it reaching world picking behind the panel. */

/** A mode the panel holds until the player commits or cancels it; while active it claims the whole canvas. */
export interface HeldMode {
  isActive(): boolean;
  cancel(): void;
  /** True when this mode took the press; the first claimer wins. */
  handleClick(clientX: number, clientY: number): boolean;
  placeBanner(): void;
}

export interface ToolPanelInputDeps {
  readonly canvas: HTMLCanvasElement;
  readonly toCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  readonly windows: ToolWindows;
  readonly held: readonly HeldMode[];
  readonly bindings: KeyBindings;
  /** Close the open central window; true when one was open. */
  readonly closeWindow: () => boolean;
  /** True while another surface owns the keyboard (the system menu); Escape is then its press. */
  readonly keyboardOwned?: () => boolean;
  readonly togglePause: () => void;
  /** The GUI click: a held mode called off by right-click or Esc fails (Esc is an approximation: only
   *  the mouse cancel is byte-verified). */
  readonly cue: (cue: UiCue) => void;
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
}

export interface ToolPanelInput {
  dispose(): void;
}

export function createToolPanelInput(deps: ToolPanelInputDeps): ToolPanelInput {
  const { canvas, toCanvas, windows, held } = deps;
  const anyHeld = (): boolean => held.some((m) => m.isActive());

  const onMouseDown = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const consume = (): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    // Right button cancels an active placement or held paper; otherwise it is a world order for unit controls.
    if (e.button === 2) {
      if (anyHeld()) {
        // Order-independent with unit controls: when it runs first the still-held claim makes it
        // defer; when it runs later, stopping the event keeps the now-clear claim from reading the
        // press as a world move order.
        consume();
        deps.cue('fail');
        for (const mode of held) mode.cancel();
        return;
      }
      // macOS delivers Ctrl+left-click as button 2, so with nothing to cancel it falls through as the
      // primary press and the Ctrl coarse step still works.
      if (!e.ctrlKey) return;
    } else if (e.button !== 0) return;
    // A higher overlay covers this point, so its own handler takes the press instead.
    if (deps.deferToOverlay?.(e.clientX, e.clientY) === true) return;

    // Priority: open pop-up > a held mode.
    let consumed = windows.handleClick(x, y, { bigStep: e.ctrlKey || e.metaKey });
    for (const mode of held) {
      if (consumed) break;
      consumed = mode.handleClick(e.clientX, e.clientY);
    }
    if (consumed) e.stopImmediatePropagation();
  };

  const onMouseMove = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    windows.handleHover(x, y);
  };

  // A wheel over an open pop-up belongs to that window; its default would scroll the page behind the
  // canvas.
  const onWheel = (e: WheelEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    if (windows.handleWheel(x, y, e.deltaY)) e.preventDefault();
  };

  // Escape steps back one level per press: a held mode, then the open central window. It runs in the
  // capture phase so the unit controls' own ladder (job list, armed order, selection) only sees a
  // press the shell left alone, whichever listener registered first. A text field, a modal dialog
  // and the system menu keep their own Escape.
  const keyboardOwned = (e: KeyboardEvent): boolean =>
    isTypingTarget(e.target) ||
    (e.target instanceof Element && e.target.closest('[aria-modal="true"]') !== null) ||
    deps.keyboardOwned?.() === true;
  const onKeyDown = (e: KeyboardEvent): void => {
    const sheet = windows.byId.mission;
    if (e.code === 'Escape') {
      if (keyboardOwned(e)) return;
      if (anyHeld()) {
        deps.cue('fail');
        for (const mode of held) mode.cancel();
      } else if (!deps.closeWindow()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (isActionHotkey(e, deps.bindings, 'pauseToggle')) {
      e.preventDefault();
      // The mission sheet holds the game paused under it, so the hotkey waits until it is gone.
      if (!sheet.isOpen()) deps.togglePause();
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown, { capture: true });

  return {
    dispose(): void {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    },
  };
}
