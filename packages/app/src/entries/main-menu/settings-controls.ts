import {
  assignBinding,
  isBindableCode,
  KEYBINDING_ACTIONS,
  type KeybindingAction,
  keyDisplayLabel,
} from '../../hud/keybindings.js';
import { messages } from '../../i18n/index.js';
import { menuSettings, updateSettings } from './settings-state.js';

export interface ControlsTab {
  rows(): HTMLElement[];
  /** Disarm an in-progress capture; the screen calls it before every panel rebuild. */
  disarm(): void;
}

/** The Controls tab: a rebind chip per action plus the fixed-shortcut reference rows. */
export function createControlsTab(opts: {
  /** The screen's shared label+control row builder. */
  settingRow: (label: string, control: HTMLElement, options?: { readonly tip?: string }) => HTMLDivElement;
  /** Rebuild the whole panel after a successful bind; a takeover may have unbound another row. */
  repaintPanel: () => void;
}): ControlsTab {
  const text = messages().mainMenu.settings;

  // One key capture at a time; arming a chip disarms the previous one.
  let cancelCapture: (() => void) | null = null;

  const paintKeyChip = (chip: HTMLElement, code: string | null): void => {
    chip.classList.remove('is-capturing');
    chip.classList.toggle('is-unassigned', code === null);
    chip.textContent =
      code === null ? text.bindingUnassigned : keyDisplayLabel(code, { space: text.keySpace });
  };

  const startCapture = (action: KeybindingAction, chip: HTMLButtonElement): void => {
    cancelCapture?.();
    chip.classList.add('is-capturing');
    chip.textContent = text.bindingPrompt;
    const stop = (): void => {
      cancelCapture = null;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onPress, true);
      window.removeEventListener('blur', stop);
      paintKeyChip(chip, menuSettings().keyBindings[action]);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!chip.isConnected) {
        // The screen was rebuilt under the capture without a mousedown or blur (e.g. history
        // navigation); release the key untouched.
        stop();
        return;
      }
      // Modifier combos stay with the browser; a bound combo could never fire (hotkeys are plain-only).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Captured before the menu's own handlers, so Esc cancels the capture instead of navigating back.
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        stop();
        return;
      }
      if (!isBindableCode(e.code)) return;
      updateSettings({ keyBindings: assignBinding(menuSettings().keyBindings, action, e.code) });
      stop();
      opts.repaintPanel();
    };
    const onPress = (e: MouseEvent): void => {
      if (e.target !== chip) stop(); // clicking away disarms
    };
    cancelCapture = stop;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onPress, true);
    window.addEventListener('blur', stop);
  };

  const rows = (): HTMLElement[] => {
    const bindings = menuSettings().keyBindings;
    const rebindable = KEYBINDING_ACTIONS.map((action) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'main-menu__settings-key';
      paintKeyChip(chip, bindings[action]);
      chip.addEventListener('click', () => startCapture(action, chip));
      return opts.settingRow(text.bindings[action], chip, { tip: text.bindingRebindTip });
    });
    const fixedRow = (label: string, keys: string): HTMLDivElement => {
      const chip = document.createElement('span');
      chip.className = 'main-menu__settings-key is-fixed';
      chip.textContent = keys;
      return opts.settingRow(label, chip, { tip: text.bindingFixedTip });
    };
    return [
      ...rebindable,
      fixedRow(text.bindings.cancel, 'Esc'),
      fixedRow(text.bindings.addToSelection, text.shiftClick),
      fixedRow(text.bindings.coarseStep, text.ctrlClick),
      fixedRow(text.bindings.craftToggle, text.ctrlClick),
      fixedRow(text.bindings.workFlagOrder, text.ctrlRightClick),
    ];
  };

  return {
    rows,
    disarm: () => cancelCapture?.(),
  };
}
