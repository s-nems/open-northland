import { element } from '../../../hud/dom/parts/dom.js';
import { attachTipLayer } from '../../../hud/dom/parts/tip-layer.js';
import { createHudPlane } from '../../../hud/dom/root.js';
import { createSaveBrowser, type SaveBrowser } from '../../../hud/dom/save-window/browser.js';
import { displayViewOf, uiScaleFor } from '../../../hud/ui-scale.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type FlowRunner, flowRunner } from '../../../view/runtime/save-load/flow-runner.js';
import type { SaveSlotInfo, SaveStore } from '../../../view/runtime/save-load/store.js';
import { browserSaveStore } from '../../../view/runtime/save-load/store-browser.js';
import { createTooltip } from '../../../view/tooltip.js';
import { menuConfirm } from '../confirm.js';
import { menuSettings } from '../settings/state.js';
import './saves.css';

export interface MenuSavesPanelOptions {
  /** The stored saves this panel offers out of all of them, newest first; all of them when absent. */
  readonly offered?: (slots: readonly SaveSlotInfo[]) => Promise<readonly SaveSlotInfo[]>;
  readonly emptyHint: string;
  readonly onSelect: (slot: SaveSlotInfo | null) => void;
  /** Double click or Enter on a row. */
  readonly onActivate: (slot: SaveSlotInfo) => void;
  /** The offered slots, newest first, each time the list is drawn. */
  readonly onListed?: (slots: readonly SaveSlotInfo[]) => void;
}

export interface MenuSavesPanel {
  readonly element: HTMLElement;
  readonly browser: SaveBrowser;
  readonly store: SaveStore;
  /** The panel's one flow at a time, reporting on its status line. */
  readonly run: FlowRunner;
  /** Left of the status line. */
  readonly leading: HTMLElement;
  /** Right of the status line, the primary last. */
  readonly actions: HTMLElement;
  /** List the store again; the list takes the focus unless something in the panel holds it. */
  refresh(): Promise<void>;
  dispose(): void;
}

/** The game's HUD scale for this display and window, with the player's own factor, so the list reads at
 *  the size the in-game window does. */
function hudScale(): number {
  return uiScaleFor(displayViewOf(window.innerWidth, window.innerHeight), menuSettings().uiScaleFactor);
}

/** The in-game load window's search, parchment list and footer on a menu screen: the same rows, groups,
 *  thumbnails and keys, over the browser's save store, on a HUD plane scaled as the game's. Deleting asks
 *  in the menu's own dialog. */
export function menuSavesPanel(opts: MenuSavesPanelOptions): MenuSavesPanel {
  const copy = messages().saveList;
  const scope = new AbortController();
  const store = browserSaveStore();
  const host = element('div', 'main-menu__saves');
  const plane = createHudPlane(hudScale());
  window.addEventListener('resize', () => void plane.setUiScale(hudScale()), { signal: scope.signal });
  const panel = element('div', 'on-panel on-saves main-menu__saves-panel');
  const body = element('div', 'main-menu__saves-body');
  const status = element('p', 'on-saves__status');
  status.setAttribute('role', 'status');
  const leading = element('div', 'on-saves__leading');
  const actions = element('div', 'on-saves__actions');
  const foot = element('div', 'on-saves__foot');
  foot.append(leading, status, actions);
  panel.append(body, foot);
  plane.element.append(panel);
  host.append(plane.element);

  const run = flowRunner((text) => {
    status.textContent = text ?? '';
  }, copy.actionFailed);
  const browser = createSaveBrowser({
    list: async () => {
      const slots = await store.list();
      return opts.offered === undefined ? slots : opts.offered(slots);
    },
    running: null,
    signal: scope.signal,
    emptyHint: opts.emptyHint,
    onSelect: opts.onSelect,
    onActivate: opts.onActivate,
    onDelete: (slot) =>
      run(async () => {
        const confirmed = await menuConfirm(host, {
          title: copy.del,
          message: formatMessage(copy.deleteConfirm, { name: slot.name }),
          confirm: copy.del,
          cancel: copy.cancel,
        });
        if (!confirmed) return null;
        try {
          await store.remove(slot.id);
        } catch {
          return copy.deleteFailed;
        }
        await refresh();
        return copy.deleted;
      }),
  });
  body.append(browser.search, browser.sheet.el);

  const chip = createTooltip();
  const tips = attachTipLayer(panel, chip);
  async function refresh(): Promise<void> {
    const slots = await browser.refresh();
    if (slots === null) return;
    // A tip shown on a redrawn row would outlive it.
    tips.hide();
    // A deleted row took the focus with it; left on the page, Esc would leave the whole screen.
    if (!panel.contains(document.activeElement) && !browser.sheet.focus())
      foot.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    opts.onListed?.(slots);
  }

  return {
    element: host,
    browser,
    store,
    run,
    leading,
    actions,
    refresh,
    dispose() {
      scope.abort();
      tips.dispose();
      chip.destroy();
    },
  };
}
