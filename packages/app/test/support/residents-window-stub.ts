import type { ResidentsWindow } from '../../src/hud/dom/residents-window.js';
import { INITIAL_RESIDENTS_STATE, NO_RESIDENT_FILTERS } from '../../src/hud/tool-panel/residents/rows.js';

/** A residents window without a DOM: the registry only asks it to open, close, refresh and keep its
 *  state. */
export function stubResidentsWindow(): ResidentsWindow {
  let open = false;
  let state = INITIAL_RESIDENTS_STATE;
  return {
    isOpen: () => open,
    toggle: () => {
      open = !open;
      if (open) state = { ...state, filters: NO_RESIDENT_FILTERS, scrollTop: 0 };
    },
    close: () => {
      open = false;
    },
    claims: () => false,
    handleClick: () => false,
    refresh: () => undefined,
    state: () => state,
    restore: (next) => {
      state = next;
    },
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
}
