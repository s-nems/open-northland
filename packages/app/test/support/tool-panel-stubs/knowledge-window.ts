import type { KnowledgeWindow } from '../../../src/hud/dom/knowledge/window.js';

/** A Knowledge window without a DOM: the registry only asks it to open, close and place. */
export function stubKnowledgeWindow(): KnowledgeWindow & { readonly shown: number[] } {
  let open = false;
  const shown: number[] = [];
  return {
    shown,
    isOpen: () => open,
    toggle: () => {
      open = !open;
    },
    close: () => {
      open = false;
    },
    show: () => {
      open = true;
    },
    showBuilding: (typeId) => {
      shown.push(typeId);
      open = true;
    },
    escape: () => false,
    place: () => undefined,
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
}
