import type { PendingWindow } from '../../src/hud/tool-panel/pending-window.js';

/** A pending window without a DOM: the registry only asks it to open, close and place. */
export function stubPendingWindow(): PendingWindow {
  let open = false;
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
    place: () => undefined,
    onClose: () => undefined,
    dispose: () => undefined,
  };
}
