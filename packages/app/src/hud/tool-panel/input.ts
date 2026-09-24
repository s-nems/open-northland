import type { UiCue } from '@open-northland/audio';
import { isActionHotkey, isFieldKey } from '../hotkeys.js';
import { isFunctionKeyCode, type KeyBindings, type KeybindingAction } from '../keybindings.js';
import { NAV_ENTRY_IDS, type NavEntryId } from './nav-effects.js';
import type { ToolWindows } from './windows.js';

/** Every branch here that consumes a press stops it reaching world picking behind the panel. */

/** A mode the panel holds until the player commits or cancels it; while active it claims the whole canvas. */
export interface HeldMode {
  isActive(): boolean;
  cancel(): void;
  /** True when this mode took the press; the first claimer wins. */
  handleClick(clientX: number, clientY: number): boolean;
  /** Undo the mode's last step without leaving it, as a line tool drops its started line; false when
   *  there is no step to undo and the press should cancel the mode. */
  stepBack?(): boolean;
}

/** The action whose key toggles each beam entry. */
const NAV_KEYS: Readonly<Record<NavEntryId, KeybindingAction>> = {
  build: 'construction',
  residents: 'residents',
  assistant: 'assistant',
  statistics: 'statistics',
  mission: 'mission',
  diplomacy: 'diplomacy',
  knowledge: 'knowledge',
};

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
  /** True while the unit controls would take an Escape themselves (a job list, an armed pick, a
   *  selection), the rungs of the cancel ladder below the shell's own. */
  readonly escapeClaimed?: () => boolean;
  readonly openMenu: () => void;
  /** Toggle a beam entry's window, as a press on the beam does. */
  readonly toggleNav: (id: NavEntryId) => void;
  readonly togglePause: () => void;
  readonly toggleHud: () => void;
  /** The GUI click: a held mode called off by right-click or Esc fails (Esc is an approximation: only
   *  the mouse cancel is original behavior). */
  readonly cue: (cue: UiCue) => void;
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
}

export interface ToolPanelInput {
  dispose(): void;
}

export function createToolPanelInput(deps: ToolPanelInputDeps): ToolPanelInput {
  const { canvas, toCanvas, windows, held } = deps;
  const anyHeld = (): boolean => held.some((m) => m.isActive());
  /** One rung per press: a mode's own step back first, otherwise every held mode is called off. */
  const cancelOneRung = (): void => {
    if (held.some((m) => m.isActive() && m.stepBack?.() === true)) return;
    for (const mode of held) mode.cancel();
  };

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
        cancelOneRung();
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
  // press the shell left alone, whichever listener registered first. Those two rungs outrank a DOM
  // surface's own Escape too, so a pinned note or an open breakdown waits for the press after the
  // window's. A text field, a modal dialog and the system menu keep their own keys.
  const modalOwned = (e: KeyboardEvent): boolean =>
    (e.target instanceof Element && e.target.closest('[aria-modal="true"]') !== null) ||
    deps.keyboardOwned?.() === true;
  const keyboardOwned = (e: KeyboardEvent): boolean => isFieldKey(e) || modalOwned(e);
  const consume = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // Whether the unit controls would take the Escape now in flight, read before any bubble listener
  // (theirs included) could act on it.
  let escapeClaimed = false;
  const onKeyDown = (e: KeyboardEvent): void => {
    // The F-row is the game's while it runs, bound or not, under a dialog or in a field: the browser's
    // own F1 help, F3 find, F5 reload or F7 caret prompt must never fire over a match. A Ctrl, Alt or
    // Meta chord stays the system's (Alt+F4 closes the window) unless an action binds it.
    if (isFunctionKeyCode(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey) e.preventDefault();
    if (e.code === 'Escape') {
      escapeClaimed = false;
      if (keyboardOwned(e)) return;
      if (anyHeld()) {
        deps.cue('fail');
        cancelOneRung();
      } else if (!deps.closeWindow()) {
        escapeClaimed = deps.escapeClaimed?.() === true;
        return;
      }
      consume(e);
      return;
    }
    if (isActionHotkey(e, deps.bindings, 'gameMenu')) {
      if (keyboardOwned(e)) return;
      consume(e);
      deps.openMenu();
      return;
    }
    if (isActionHotkey(e, deps.bindings, 'hudToggle')) {
      if (modalOwned(e)) return;
      consume(e);
      deps.toggleHud();
      return;
    }
    for (const entry of NAV_ENTRY_IDS) {
      if (!isActionHotkey(e, deps.bindings, NAV_KEYS[entry])) continue;
      if (modalOwned(e)) return;
      consume(e);
      deps.toggleNav(entry);
      return;
    }
    if (isActionHotkey(e, deps.bindings, 'pauseToggle')) {
      e.preventDefault();
      deps.togglePause();
    }
  };

  // The game menu is the ladder's last rung when Escape is its key: it opens in the bubble phase, so a
  // DOM surface with an Escape of its own (a counter's breakdown, a pinned note, the admin palette)
  // takes the press first once the rungs above are clear, and only when the unit controls did not.
  const onEscapeMenu = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' || e.defaultPrevented || !isActionHotkey(e, deps.bindings, 'gameMenu')) return;
    if (keyboardOwned(e) || escapeClaimed) return;
    consume(e);
    deps.openMenu();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keydown', onEscapeMenu);

  return {
    dispose(): void {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keydown', onEscapeMenu);
    },
  };
}
