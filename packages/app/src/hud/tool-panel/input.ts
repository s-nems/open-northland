import type { UiCue } from '@open-northland/audio';
import { isActionHotkey, isFieldKey } from '../hotkeys.js';
import { isFunctionKeyCode, type KeyBindings, type KeybindingAction } from '../keybindings.js';
import { NAV_ENTRY_IDS, type NavEntryId } from './nav-effects.js';

/** Every branch here that consumes a press stops it reaching world picking behind the panel. */

/** A mode the panel holds until the player commits or cancels it; while active it claims the whole canvas. */
export interface HeldMode {
  isActive(): boolean;
  cancel(): void;
  /** True when this mode took the press; the first claimer wins. `keep` (Ctrl or Cmd held) keeps a tool
   *  armed after the press completes its work. */
  handleClick(clientX: number, clientY: number, mods?: { readonly keep: boolean }): boolean;
  /** The pointer moved with the left button down; a brush paints along it from the press it took. */
  handleDrag?(clientX: number, clientY: number): void;
  /** The left button went up, wherever the pointer is. */
  handleRelease?(): void;
  /** Undo the mode's last step without leaving it, as a line tool drops its started line; false when
   *  there is no step to undo and the press should cancel the mode. */
  stepBack?(): boolean;
  /** Shift is held: a line tool keeps its line straight, and a building placed under it stays held. */
  setShift?(on: boolean): void;
  /** Alt is held: the road tool's line cancels road sites instead of ordering them. */
  setErase?(on: boolean): void;
  /** The upgrade-ground key: a wall or road line takes or skirts that ground; false when no line is held. */
  toggleUpgradeGround?(): boolean;
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
  /** Open the game menu straight on its load or save page; absent where the session offers none. */
  readonly openLoad?: () => void;
  readonly openSave?: () => void;
  /** Toggle a beam entry's window, as a press on the beam does. */
  readonly toggleNav: (id: NavEntryId) => void;
  readonly togglePause: () => void;
  /** Step the running speed ×1 → ×2 → ×3 → ×1; a pause resumes at ×1. */
  readonly cycleSpeed: () => void;
  readonly toggleHud: () => void;
  /** Open or close the network window; absent outside a relayed game, which leaves its key alone. */
  readonly toggleNetwork?: () => void;
  readonly toggleDiplomacyMap: () => void;
  /** Hold the road tool; absent where the game offers none, which leaves its key to the page. */
  readonly roadTool?: () => void;
  /** Hold the palisade wall tool; absent where the game offers none. */
  readonly palisadeTool?: () => void;
  /** Hold the gate tool; absent where the game offers none. */
  readonly gateTool?: () => void;
  /** The GUI click: a held mode called off by right-click or Esc fails (Esc is an approximation: only
   *  the mouse cancel is original behavior). */
  readonly cue: (cue: UiCue) => void;
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
  /** Whether the platform reports Ctrl with the left button as the right button, as macOS does;
   *  detected from the browser when omitted. */
  readonly ctrlClickIsRightButton?: boolean;
}

/** `MouseEvent.buttons` bit of the left button. */
const LEFT_BUTTON_HELD = 1;

/** macOS turns Ctrl with the left button into a right-button press. */
function platformCtrlClickIsRightButton(): boolean {
  return typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);
}

export interface ToolPanelInput {
  /** A right press on a surface that is not the game canvas, as the map overview: true when it called a
   *  held mode off, one rung, so it orders nothing. */
  callOffHeld(press: MouseEvent): boolean;
  dispose(): void;
}

export function createToolPanelInput(deps: ToolPanelInputDeps): ToolPanelInput {
  const { canvas, held } = deps;
  const anyHeld = (): boolean => held.some((m) => m.isActive());
  const ctrlClickIsRightButton = deps.ctrlClickIsRightButton ?? platformCtrlClickIsRightButton();
  /** One rung per press: a mode's own step back first, otherwise every held mode is called off. */
  const cancelOneRung = (): void => {
    if (held.some((m) => m.isActive() && m.stepBack?.() === true)) return;
    for (const mode of held) mode.cancel();
  };
  // Where Ctrl+left-click arrives as button 2, a Ctrl press counts as the primary press, so a wall tool
  // stays armed for the next line.
  const isRightPress = (e: MouseEvent): boolean => e.button === 2 && !(e.ctrlKey && ctrlClickIsRightButton);
  const callOffHeld = (e: MouseEvent): boolean => {
    if (!isRightPress(e) || !anyHeld()) return false;
    deps.cue('fail');
    cancelOneRung();
    return true;
  };

  // Every pointer event reports Shift and Alt too, so one pressed while another window had focus still
  // counts.
  const syncShift = (on: boolean): void => {
    for (const mode of held) mode.setShift?.(on);
  };
  const syncErase = (on: boolean): void => {
    for (const mode of held) mode.setErase?.(on);
  };
  const syncModifiers = (e: MouseEvent): void => {
    syncShift(e.shiftKey);
    syncErase(e.altKey);
  };
  const onModifierKey = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') syncShift(e.type === 'keydown');
    if (e.key === 'Alt') syncErase(e.type === 'keydown');
  };
  const onBlur = (): void => {
    syncShift(false);
    syncErase(false);
    for (const mode of held) mode.handleRelease?.();
  };

  const onMouseDown = (e: MouseEvent): void => {
    syncModifiers(e);
    const consume = (): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    // Right button cancels an active placement or held paper; otherwise it is a world order for unit controls.
    if (isRightPress(e)) {
      // Order-independent with unit controls: when it runs first the still-held claim makes it
      // defer; when it runs later, stopping the event keeps the now-clear claim from reading the
      // press as a world move order.
      if (callOffHeld(e)) consume();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    // A higher overlay covers this point, so its own handler takes the press instead.
    if (deps.deferToOverlay?.(e.clientX, e.clientY) === true) return;

    if (held.some((mode) => mode.handleClick(e.clientX, e.clientY, { keep: e.ctrlKey || e.metaKey }))) {
      e.stopImmediatePropagation();
    }
  };

  const onMouseMove = (e: MouseEvent): void => {
    syncModifiers(e);
    if ((e.buttons & LEFT_BUTTON_HELD) === 0) return;
    for (const mode of held) mode.handleDrag?.(e.clientX, e.clientY);
  };

  const onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    for (const mode of held) mode.handleRelease?.();
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
    if (isActionHotkey(e, deps.bindings, 'upgradeGround') && !modalOwned(e)) {
      if (held.some((m) => m.isActive() && m.toggleUpgradeGround?.() === true)) {
        consume(e);
        return;
      }
    }
    const pressed: readonly [KeybindingAction, (() => void) | undefined][] = [
      ['roadTool', deps.roadTool],
      ['palisadeTool', deps.palisadeTool],
      ['gateTool', deps.gateTool],
      ['loadGame', deps.openLoad],
      ['saveGame', deps.openSave],
      ['network', deps.toggleNetwork],
      ['diplomacyMap', deps.toggleDiplomacyMap],
    ];
    for (const [action, run] of pressed) {
      if (run === undefined || !isActionHotkey(e, deps.bindings, action)) continue;
      if (modalOwned(e)) return;
      consume(e);
      run();
      return;
    }
    // A modal dialog types its letters into its own search, so P and L stay its.
    if (isActionHotkey(e, deps.bindings, 'pauseToggle')) {
      if (modalOwned(e)) return;
      e.preventDefault();
      deps.togglePause();
    } else if (isActionHotkey(e, deps.bindings, 'speedCycle')) {
      if (modalOwned(e)) return;
      e.preventDefault();
      deps.cycleSpeed();
    }
  };

  // The game menu is the ladder's last rung when Escape is its key: it opens in the bubble phase, so a
  // DOM surface with an Escape of its own (a counter's breakdown, a pinned note, the debug tools' panel)
  // takes the press first once the rungs above are clear, and only when the unit controls did not.
  const onEscapeMenu = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' || e.defaultPrevented || !isActionHotkey(e, deps.bindings, 'gameMenu')) return;
    if (keyboardOwned(e) || escapeClaimed) return;
    consume(e);
    deps.openMenu();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keydown', onEscapeMenu);
  window.addEventListener('keydown', onModifierKey);
  window.addEventListener('keyup', onModifierKey);
  window.addEventListener('blur', onBlur);

  return {
    callOffHeld,
    dispose(): void {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keydown', onEscapeMenu);
      window.removeEventListener('keydown', onModifierKey);
      window.removeEventListener('keyup', onModifierKey);
      window.removeEventListener('blur', onBlur);
    },
  };
}
