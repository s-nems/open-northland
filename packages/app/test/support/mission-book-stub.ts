import type { MissionBook, MissionWindowState } from '../../src/hud/dom/mission-book/index.js';

/** The mission book's registry face without a DOM: it opens, closes and carries its state. */
export function stubMissionBook(): MissionBook & { readonly shownPages: readonly number[] } {
  let open = false;
  const shownPages: number[] = [];
  let state: MissionWindowState = { page: null, pages: [], reading: null, held: false, slipFolded: false };
  return {
    shownPages,
    isOpen: () => open,
    toggle: () => {
      open = !open;
    },
    close: () => {
      open = false;
    },
    claims: () => false,
    handleClick: () => false,
    showPage: (page) => {
      open = true;
      shownPages.push(page);
    },
    state: () => state,
    restore: (next) => {
      state = next;
    },
    refresh: () => undefined,
    dropSlip: () => undefined,
    views: () => [],
    unread: () => false,
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
}
