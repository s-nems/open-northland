import type { DiplomacyWindow } from '../../src/hud/dom/diplomacy-window/index.js';

export function stubDiplomacyWindow(): DiplomacyWindow {
  let open = false;
  let player: number | null = null;
  return {
    isOpen: () => open,
    toggle: () => {
      open = !open;
    },
    close: () => {
      open = false;
    },
    claims: () => false,
    handleClick: () => false,
    refresh: () => undefined,
    state: () => player,
    restore: (next) => {
      player = next;
    },
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
}
