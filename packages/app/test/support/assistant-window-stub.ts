import type { AssistantWindow } from '../../src/hud/dom/assistant-window/index.js';

/** An assistant window without a DOM: the registry only asks it to open, close, refresh and take the
 *  tick's stock. */
export function stubAssistantWindow(): AssistantWindow {
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
    refresh: () => undefined,
    update: () => undefined,
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
}
