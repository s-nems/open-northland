import type { DiplomacyWindow } from '../../../src/hud/dom/diplomacy-window/index.js';

export function stubDiplomacyWindow(): DiplomacyWindow {
  let open = false;
  return {
    isOpen: () => open,
    toggle: () => {
      open = !open;
    },
    close: () => {
      open = false;
    },
    showNation: () => {
      open = true;
    },
    refresh: () => undefined,
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
}
