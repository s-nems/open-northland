import { messages } from '../../../i18n/index.js';
import { NAV_BEAM_H } from '../../nav-beam.js';
import { TOP_BAR_HEIGHT } from '../../regions.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setHidden, write } from '../parts/dom.js';
import { createActTab } from './act-tab.js';
import { createAiTab } from './ai-tab.js';
import type {
  AdminAiSeat,
  AdminArmed,
  AdminPanelHandlers,
  AdminPanelSpec,
  AdminTab,
  AdminWorldState,
} from './model.js';
import { createSpawnTab } from './spawn-tab.js';
import { createWorldTab } from './world-tab.js';

/** Design px between the bar's lower edge and the panel, and the panel and the screen's right edge. */
const PANEL_GAP_PX = 6;
/** How long the copy button reads "copied" before it turns back. */
const COPIED_FLASH_MS = 1500;
const TABS: readonly AdminTab[] = ['spawn', 'act', 'world', 'ai'];

/**
 * The debug tools: a toggle that stands in the system bar's lead and a panel it drops below the bar at
 * the right edge. The panel only shows and reports; its owner arms tools and issues their orders.
 */
export interface AdminPanel {
  /** Placed by the owner into the bar's lead. */
  readonly toggle: HTMLButtonElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
  /** Hidden takes the toggle down and closes the panel. */
  setVisible(visible: boolean): void;
  showArmed(armed: AdminArmed | null): void;
  showWorld(state: AdminWorldState): void;
  showAi(seats: readonly AdminAiSeat[]): void;
  showCursor(text: string): void;
  dispose(): void;
}

let nextPanelId = 0;

export function createAdminPanel(
  plane: HTMLElement,
  spec: AdminPanelSpec,
  handlers: AdminPanelHandlers,
): AdminPanel {
  const copy = messages().admin;
  const panelId = `on-admin-${nextPanelId++}`;

  const toggle = button('on-admin-toggle', `${GLYPH.tool}${GLYPH.down}`);
  toggle.setAttribute('aria-label', copy.title);
  toggle.setAttribute('aria-controls', panelId);
  toggle.setAttribute('aria-expanded', 'false');

  const panel = element('section', 'on-admin on-panel');
  panel.id = panelId;
  panel.hidden = true;
  panel.setAttribute('aria-label', copy.title);
  panel.style.top = `${TOP_BAR_HEIGHT + PANEL_GAP_PX}px`;
  panel.style.right = `${PANEL_GAP_PX}px`;
  panel.style.maxHeight = `calc(100% - ${TOP_BAR_HEIGHT + NAV_BEAM_H + 2 * PANEL_GAP_PX}px)`;

  const head = element('header', 'on-admin__head', GLYPH.tool);
  const title = element('h2', 'on-admin__title');
  write(title, copy.title);
  const close = button('on-medallion on-admin__close', GLYPH.close);
  close.setAttribute('aria-label', copy.close);
  head.append(title, close);

  const tabStrip = element('div', 'on-admin__tabs');
  tabStrip.setAttribute('role', 'tablist');
  tabStrip.setAttribute('aria-label', copy.tabsLabel);
  const spawn = createSpawnTab(spec, handlers);
  const act = createActTab(spec, handlers);
  const world = createWorldTab(spec, handlers);
  const ai = createAiTab();
  const panes: Readonly<Record<AdminTab, HTMLElement>> = {
    spawn: spawn.element,
    act: act.element,
    world: world.element,
    ai: ai.element,
  };
  const body = element('div', 'on-admin__body');
  let tab: AdminTab = 'spawn';
  const tabButtons = TABS.map((key) => {
    const tabButton = button('on-admin__tab');
    tabButton.setAttribute('role', 'tab');
    write(tabButton, copy.tabs[key]);
    const pane = panes[key];
    pane.id = `${panelId}-${key}`;
    pane.setAttribute('role', 'tabpanel');
    tabButton.setAttribute('aria-controls', pane.id);
    tabButton.addEventListener('click', () => {
      tab = key;
      paintTab();
      syncAiView();
    });
    tabStrip.append(tabButton);
    body.append(pane);
    return { key, tabButton };
  });
  const paintTab = (): void => {
    for (const { key, tabButton } of tabButtons) {
      setAttribute(tabButton, 'aria-selected', String(key === tab));
      setHidden(panes[key], key !== tab);
    }
    body.scrollTop = 0;
  };

  const foot = element('footer', 'on-admin__foot');
  const status = element('div', 'on-admin__status');
  const statusText = element('div', 'on-admin__status-text');
  const statusName = element('b', '');
  const statusHint = element('small', '');
  statusText.append(statusName, statusHint);
  const disarm = button('on-admin__disarm');
  const disarmLabel = element('span', '');
  write(disarmLabel, copy.disarm);
  const disarmKeys = element('kbd', 'on-key');
  write(disarmKeys, copy.disarmKeys);
  disarm.append(disarmLabel, disarmKeys);
  disarm.addEventListener('click', () => handlers.onDisarm());
  status.append(statusText, disarm);

  const cursorRow = element('div', 'on-admin__cursor');
  const cursor = element('span', 'on-admin__cursor-text');
  write(cursor, copy.cursorOffMap);
  const cursorHint = element('small', '');
  write(cursorHint, copy.cursorHint);
  const copyButton = button('on-admin__copy');
  write(copyButton, copy.copy);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  copyButton.addEventListener('click', () => {
    // Absent off a secure origin, such as a preview opened by LAN address; the text stays selectable.
    navigator.clipboard?.writeText(cursor.textContent ?? '').then(
      () => {
        write(copyButton, copy.copied);
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => write(copyButton, copy.copy), COPIED_FLASH_MS);
      },
      () => undefined,
    );
  });
  cursorRow.append(cursor, cursorHint, copyButton);
  foot.append(status, cursorRow);

  panel.append(head, tabStrip, body, foot);
  plane.append(panel);

  let open = false;
  let aiShown = false;
  const syncAiView = (): void => {
    const next = open && tab === 'ai';
    if (next === aiShown) return;
    aiShown = next;
    handlers.onAiView(next);
  };
  const setOpen = (next: boolean): void => {
    if (next === open) return;
    open = next;
    panel.hidden = !next;
    setAttribute(toggle, 'aria-expanded', String(next));
    handlers.onOpen(next);
    syncAiView();
  };
  toggle.addEventListener('click', () => setOpen(!open));
  close.addEventListener('click', () => setOpen(false));
  // Esc inside the panel closes it; an armed tool's Esc is taken before it reaches here.
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setOpen(false);
    toggle.focus();
  });

  const showArmed = (armed: AdminArmed | null): void => {
    const key = armed?.key ?? null;
    spawn.showArmed(key);
    act.showArmed(key);
    setAttribute(toggle, 'data-armed', String(armed !== null));
    status.dataset.armed = String(armed !== null);
    write(statusName, armed?.name ?? copy.idle);
    write(statusHint, armed?.hint ?? '');
    setHidden(statusHint, armed === null);
    setHidden(disarm, armed === null);
  };
  paintTab();
  showArmed(null);

  return {
    toggle,
    isOpen: () => open,
    setOpen,
    setVisible(visible): void {
      setHidden(toggle, !visible);
      if (!visible) setOpen(false);
    },
    showArmed,
    showWorld: (state) => world.show(state),
    showAi: (seats) => ai.show(seats),
    showCursor: (text) => write(cursor, text),
    dispose(): void {
      clearTimeout(copiedTimer);
      toggle.remove();
      panel.remove();
    },
  };
}
