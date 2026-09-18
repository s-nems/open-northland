import type { ConstructionWindow } from '../../src/hud/dom/construction-window.js';
import { INITIAL_CONSTRUCTION_STATE } from '../../src/hud/tool-panel/building-menu.js';
import type { ConstructionWindowSeam } from '../../src/hud/tool-panel/windows.js';

/** A construction window without a DOM: the registry's open, close, suspend and resume plumbing,
 *  with the seam the registry handed it kept for a test to press its buttons. */
export interface ConstructionWindowStub extends ConstructionWindow {
  readonly seam: ConstructionWindowSeam;
  /** The stock models `update` received. */
  readonly models: unknown[];
}

export function stubConstructionWindow(seam: ConstructionWindowSeam): ConstructionWindowStub {
  let open = false;
  let state = INITIAL_CONSTRUCTION_STATE;
  const models: unknown[] = [];
  const stub: ConstructionWindowStub = {
    seam,
    models,
    isOpen: () => open,
    toggle: () => {
      open = !open;
      if (!open) state = { ...state, suspended: false };
    },
    close: () => {
      open = false;
      state = { ...state, suspended: false };
    },
    claims: () => false,
    handleClick: () => false,
    place: () => undefined,
    refresh: () => undefined,
    update: (model) => {
      models.push(model);
    },
    suspend: () => {
      if (!open) return;
      open = false;
      state = { ...state, suspended: true };
    },
    resume: () => {
      if (!state.suspended) return;
      state = { ...state, suspended: false };
      open = true;
    },
    state: () => state,
    restore: (next) => {
      state = next;
    },
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
  return stub;
}
