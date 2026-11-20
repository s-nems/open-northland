import type { ToolWindow } from '../../../src/hud/tool-panel/window-shell.js';

export function stubDiplomacyMap(): ToolWindow {
  let open = false;
  return {
    isOpen: () => open,
    toggle: () => {
      open = !open;
    },
    close: () => {
      open = false;
    },
  };
}
