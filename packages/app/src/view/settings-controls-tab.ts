import {
  assignBinding,
  isBindableCode,
  KEYBINDING_ACTIONS,
  type KeybindingAction,
  keyDisplayLabel,
} from '../hud/keybindings.js';
import { messages } from '../i18n/index.js';
import type { MenuSettings } from './settings-store.js';

export interface ControlsTab {
  rows(): HTMLElement[];
  disarm(): void;
}

export function createControlsTab(opts: {
  readonly current: () => MenuSettings;
  readonly update: (patch: Partial<MenuSettings>) => Promise<boolean>;
  readonly settingRow: (
    label: string,
    control: HTMLElement,
    options?: { readonly tip?: string },
  ) => HTMLDivElement;
  readonly repaintPanel: (focusKey?: string) => void;
  readonly deferredTip?: string;
}): ControlsTab {
  let cancelCapture: (() => void) | null = null;

  const paintKeyChip = (chip: HTMLElement, code: string | null): void => {
    const text = messages().mainMenu.settings;
    chip.classList.remove('is-capturing');
    chip.classList.toggle('is-unassigned', code === null);
    chip.textContent =
      code === null ? text.bindingUnassigned : keyDisplayLabel(code, { space: text.keySpace });
  };

  const startCapture = (action: KeybindingAction, chip: HTMLButtonElement): void => {
    cancelCapture?.();
    const text = messages().mainMenu.settings;
    chip.classList.add('is-capturing');
    chip.textContent = text.bindingPrompt;
    const stop = (): void => {
      cancelCapture = null;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onPress, true);
      window.removeEventListener('blur', stop);
      paintKeyChip(chip, opts.current().keyBindings[action]);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (!chip.isConnected) {
        stop();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        stop();
        return;
      }
      if (!isBindableCode(event.code)) return;
      const next = assignBinding(opts.current().keyBindings, action, event.code);
      void opts.update({ keyBindings: next }).then((applied) => {
        stop();
        if (applied) opts.repaintPanel(`binding:${action}`);
      });
    };
    const onPress = (event: MouseEvent): void => {
      if (event.target !== chip) stop();
    };
    cancelCapture = stop;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onPress, true);
    window.addEventListener('blur', stop);
  };

  const rows = (): HTMLElement[] => {
    const text = messages().mainMenu.settings;
    const bindings = opts.current().keyBindings;
    const rebindable = KEYBINDING_ACTIONS.map((action) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'main-menu__settings-key';
      chip.dataset.settingsFocus = `binding:${action}`;
      paintKeyChip(chip, bindings[action]);
      chip.addEventListener('click', () => startCapture(action, chip));
      return opts.settingRow(text.bindings[action], chip, {
        tip:
          opts.deferredTip === undefined
            ? text.bindingRebindTip
            : `${text.bindingRebindTip} ${opts.deferredTip}`,
      });
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
