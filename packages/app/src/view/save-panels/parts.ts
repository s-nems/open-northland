import { bcp47Tag, messages } from '../../i18n/index.js';
import type { SaveLoadSession } from '../runtime/save-load/index.js';
import { formatPlaytime, formatSavedAt } from '../runtime/save-load/list-model.js';
import type { SaveSlotInfo } from '../runtime/save-load/store.js';
import type { WorldNameOf } from '../runtime/save-load/world-names.js';

/** The pieces the save and load panels share: the slot list, the status line, and their styles. */

export interface SavePanelDeps {
  readonly saveLoad: SaveLoadSession;
  /** Swap the modal back to the menu's root buttons; the menu itself owns the forced pause. */
  readonly showMenu: () => void;
  readonly panelStyle: string;
  readonly buttonStyle: string;
}

export interface SavePanelView {
  readonly el: HTMLElement;
  /** Called when the panel becomes the modal's visible view; refreshes the list. */
  open(): void;
}

export const PANEL_WIDTH_STYLE = 'width:min(660px,92vw)';
export const SELECTED_ROW_BACKGROUND = 'rgba(138,116,74,0.45)';
export const ROW_BACKGROUND = 'rgba(74,63,40,0.35)';
const LIST_GRID_STYLE = [
  'display:grid',
  'grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) 64px 130px',
  'gap:0 10px',
  'align-items:baseline',
].join(';');
const LIST_BOX_STYLE = [
  'display:flex',
  'flex-direction:column',
  'gap:2px',
  'max-height:40vh',
  'overflow-y:auto',
  'margin:0',
  'padding:0',
].join(';');
const CELL_OVERFLOW_STYLE = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface StatusLine {
  readonly el: HTMLElement;
  set(text: string | null): void;
}

/** A one-line status that holds its height empty, so showing a message never reflows the panel
 *  under the player's cursor. */
export function statusLine(): StatusLine {
  const node = el('p', 'margin:0;min-height:1.4em;font:13px/1.4 ui-serif,Georgia,serif');
  node.setAttribute('role', 'status');
  return {
    el: node,
    set(text) {
      node.textContent = text ?? '';
    },
  };
}

/** Paints pending work before a flow's synchronous half freezes the frame. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

export interface ListParts {
  readonly box: HTMLElement;
  /** Rebuild the rows; resolves to the slots now shown, or null when the store could not be read. */
  refresh(worldName: WorldNameOf): Promise<readonly SaveSlotInfo[] | null>;
}

export function slotList(
  saveLoad: SaveLoadSession,
  setStatus: (text: string | null) => void,
  onRow: (slot: SaveSlotInfo, row: HTMLButtonElement) => void,
): ListParts {
  const copy = messages().saveList;
  const box = el('div', LIST_BOX_STYLE);
  box.setAttribute('role', 'listbox');
  const refresh = async (worldName: WorldNameOf): Promise<readonly SaveSlotInfo[] | null> => {
    let slots: readonly SaveSlotInfo[];
    try {
      slots = await saveLoad.listSaves();
    } catch {
      setStatus(copy.listFailed);
      box.replaceChildren();
      return null;
    }
    if (slots.length === 0) {
      box.replaceChildren(el('p', 'margin:4px 8px;opacity:0.8', copy.empty));
      return slots;
    }
    const header = el('div', `${LIST_GRID_STYLE};padding:2px 8px;opacity:0.7;font-size:12px`);
    for (const label of [copy.columnName, copy.columnMap, copy.columnPlaytime, copy.columnSavedAt]) {
      header.append(el('span', CELL_OVERFLOW_STYLE, label));
    }
    const rows = slots.map((slot) => {
      const row = el(
        'button',
        `${LIST_GRID_STYLE};padding:5px 8px;background:${ROW_BACKGROUND};color:inherit;font:inherit;border:none;border-radius:4px;cursor:pointer;text-align:left`,
      );
      row.type = 'button';
      const cell = (text: string): HTMLElement => el('span', CELL_OVERFLOW_STYLE, text);
      row.append(
        cell(slot.name),
        cell(worldName(slot.mapId) ?? '-'),
        cell(slot.tick !== null ? formatPlaytime(slot.tick) : '-'),
        cell(formatSavedAt(slot.savedAt, bcp47Tag())),
      );
      onRow(slot, row);
      return row;
    });
    box.replaceChildren(header, ...rows);
    return slots;
  };
  return { box, refresh };
}
