import {
  assignBinding,
  bindingAllowedFor,
  bindingFromKeyboardEvent,
  bindingFromMouseEvent,
  CONTROL_GROUP_ACTIONS,
  KEYBINDING_ACTIONS,
  type KeybindingAction,
  keyDisplayLabel,
} from '../hud/keybindings.js';
import { messages } from '../i18n/index.js';
import type { MenuSettings } from './settings-store.js';

/** The group-recall keys, whose rows also explain the centring press. */
const RECALL_ACTIONS: ReadonlySet<string> = new Set(CONTROL_GROUP_ACTIONS);

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

  const paintKeyChip = (chip: HTMLElement, binding: string | null): void => {
    const text = messages().mainMenu.settings;
    chip.classList.remove('is-capturing');
    chip.classList.toggle('is-unassigned', binding === null);
    chip.textContent =
      binding === null
        ? text.bindingUnassigned
        : keyDisplayLabel(binding, {
            space: text.keySpace,
            mouseLeft: text.mouseLeft,
            mouseMiddle: text.mouseMiddle,
            mouseRight: text.mouseRight,
          });
  };

  const startCapture = (action: KeybindingAction, chip: HTMLButtonElement): void => {
    cancelCapture?.();
    const text = messages().mainMenu.settings;
    chip.classList.add('is-capturing');
    chip.textContent = action === 'workFlagOrder' ? text.pointerBindingPrompt : text.bindingPrompt;
    const stop = (): void => {
      cancelCapture = null;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('blur', stop);
      paintKeyChip(chip, opts.current().keyBindings[action]);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (!chip.isConnected) {
        stop();
        return;
      }
      if (event.code === 'Escape' && !bindingAllowedFor(action, 'Escape')) {
        event.preventDefault();
        event.stopPropagation();
        stop();
        return;
      }
      const binding = bindingFromKeyboardEvent(event);
      if (binding === null || !bindingAllowedFor(action, binding)) return;
      event.preventDefault();
      event.stopPropagation();
      const next = assignBinding(opts.current().keyBindings, action, binding);
      void opts.update({ keyBindings: next }).then((applied) => {
        stop();
        if (applied) opts.repaintPanel(`binding:${action}`);
      });
    };
    const onMouse = (event: MouseEvent): void => {
      const binding = bindingFromMouseEvent(event);
      if (binding === null || !bindingAllowedFor(action, binding)) {
        if (event.target !== chip) stop();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const next = assignBinding(opts.current().keyBindings, action, binding);
      void opts.update({ keyBindings: next }).then((applied) => {
        stop();
        if (applied) opts.repaintPanel(`binding:${action}`);
      });
    };
    cancelCapture = stop;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
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
        tip: [
          action === 'workFlagOrder'
            ? text.pointerBindingRebindTip
            : bindingAllowedFor(action, 'Escape')
              ? text.escapeBindingRebindTip
              : text.bindingRebindTip,
          ...(RECALL_ACTIONS.has(action) ? [text.recallSelectedTip] : []),
          ...(opts.deferredTip === undefined ? [] : [opts.deferredTip]),
        ].join(' '),
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
      fixedRow(text.bindings.toggleSelection, text.shiftClick),
      fixedRow(text.bindings.selectJobMates, text.doubleClick),
      fixedRow(text.bindings.coarseStep, text.ctrlClick),
      fixedRow(text.bindings.craftToggle, text.ctrlClick),
    ];
  };

  return {
    rows,
    disarm: () => cancelCapture?.(),
  };
}
