import { bcp47Tag, formatMessage, messages } from '../i18n/index.js';
import { confirmDialog } from './confirm-dialog.js';
import { flowRunner } from './runtime/save-load/flow-runner.js';
import type { SaveLoadSession } from './runtime/save-load/index.js';
import {
  autoSaveName,
  formatPlaytime,
  formatSavedAt,
  sanitizedSaveName,
} from './runtime/save-load/list-model.js';
import type { SaveSlotInfo } from './runtime/save-load/store.js';
import { type WorldNameOf, worldNameIndex } from './runtime/save-load/world-names.js';

/**
 * The system menu's save and load panels: one list of the store's slots, saved into by name and
 * loaded from by row. Destructive actions (overwrite, delete) ask through the in-page confirm
 * dialog, never `window.confirm`.
 */

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

const PANEL_WIDTH_STYLE = 'width:min(660px,92vw)';
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
const SELECTED_ROW_BACKGROUND = 'rgba(138,116,74,0.45)';
const ROW_BACKGROUND = 'rgba(74,63,40,0.35)';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rowCells(row: HTMLElement, slot: SaveSlotInfo, worldName: WorldNameOf): void {
  const copyCell = (text: string): HTMLElement => el('span', CELL_OVERFLOW_STYLE, text);
  row.append(
    copyCell(slot.name),
    copyCell(worldName(slot.mapId) ?? '-'),
    copyCell(slot.tick !== null ? formatPlaytime(slot.tick) : '-'),
    copyCell(formatSavedAt(slot.savedAt, bcp47Tag())),
  );
}

interface ListParts {
  readonly box: HTMLElement;
  /** Rebuild the rows; resolves to the slots now shown (empty on a failed listing). */
  refresh(worldName: WorldNameOf): Promise<readonly SaveSlotInfo[]>;
}

function slotList(
  saveLoad: SaveLoadSession,
  setStatus: (text: string | null) => void,
  onRow: (slot: SaveSlotInfo, row: HTMLButtonElement) => void,
): ListParts {
  const copy = messages().saveList;
  const box = el('div', LIST_BOX_STYLE);
  box.setAttribute('role', 'listbox');
  const refresh = async (worldName: WorldNameOf): Promise<readonly SaveSlotInfo[]> => {
    let slots: readonly SaveSlotInfo[];
    try {
      slots = await saveLoad.listSaves();
    } catch {
      setStatus(copy.listFailed);
      box.replaceChildren();
      return [];
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
      rowCells(row, slot, worldName);
      onRow(slot, row);
      return row;
    });
    box.replaceChildren(
      header,
      ...(rows.length > 0 ? rows : [el('p', 'margin:4px 8px;opacity:0.8', copy.empty)]),
    );
    return slots;
  };
  return { box, refresh };
}

export function buildSavePanel(deps: SavePanelDeps): SavePanelView {
  const copy = messages().saveList;
  const hud = messages().hud;
  const panel = el('div', `${deps.panelStyle};${PANEL_WIDTH_STYLE}`);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', copy.saveTitle);

  const title = el('h2', 'margin:0 0 6px;font:18px/1.2 ui-serif,Georgia,serif', copy.saveTitle);
  const status = el('p', 'margin:0;font:13px/1.4 ui-serif,Georgia,serif;display:none');
  status.setAttribute('role', 'status');
  const setStatus = (text: string | null): void => {
    status.textContent = text ?? '';
    status.style.display = text === null ? 'none' : 'block';
  };
  const run = flowRunner(setStatus);

  const nameLabel = el('label', 'display:flex;gap:8px;align-items:center');
  nameLabel.append(el('span', '', copy.nameLabel));
  const nameInput = el(
    'input',
    'flex:1;padding:6px 8px;background:rgba(20,16,12,0.9);color:inherit;font:inherit;border:1px solid rgba(138,116,74,0.7);border-radius:4px',
  );
  nameInput.type = 'text';
  nameLabel.append(nameInput);

  /** Names on the list at the last refresh; a save into one of these asks before overwriting. */
  let existing: readonly string[] = [];

  const list = slotList(deps.saveLoad, setStatus, (slot, row) => {
    row.addEventListener('click', () => {
      nameInput.value = slot.name;
      setStatus(null);
    });
  });

  const refresh = async (): Promise<void> => {
    const worldName = await worldNameIndex();
    existing = (await list.refresh(worldName)).map((slot) => slot.name);
    if (nameInput.value === '') {
      const world = worldName(deps.saveLoad.worldToken);
      // `formatMessage` leaves the unknown `{n}` in place for `autoSaveName` to number.
      const template = world !== null ? formatMessage(copy.autoNameMap, { map: world }) : copy.autoName;
      nameInput.value = autoSaveName(template, existing);
    }
  };

  const save = el('button', deps.buttonStyle, copy.save);
  save.type = 'button';
  save.addEventListener('click', () =>
    run(async () => {
      const name = sanitizedSaveName(nameInput.value);
      if (name === null) return copy.invalidName;
      if (existing.includes(name)) {
        const confirmed = await confirmDialog({
          message: formatMessage(copy.overwriteConfirm, { name }),
          confirmLabel: copy.overwrite,
          cancelLabel: copy.cancel,
        });
        if (!confirmed) return null;
      }
      const outcome = await deps.saveLoad.saveGame(name);
      if (outcome.kind !== 'saved') return hud.saveFailed;
      await refresh();
      return hud.gameSaved;
    }),
  );
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save.click();
  });

  const back = el('button', deps.buttonStyle, copy.back);
  back.type = 'button';
  back.addEventListener('click', deps.showMenu);

  const actions = el('div', 'display:flex;gap:8px;justify-content:flex-end');
  actions.append(save, back);
  panel.append(title, nameLabel, list.box, actions, status);

  return {
    el: panel,
    open(): void {
      setStatus(null);
      void refresh();
    },
  };
}

export function buildLoadPanel(deps: SavePanelDeps): SavePanelView {
  const copy = messages().saveList;
  const hud = messages().hud;
  const panel = el('div', `${deps.panelStyle};${PANEL_WIDTH_STYLE}`);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', copy.loadTitle);

  const title = el('h2', 'margin:0 0 6px;font:18px/1.2 ui-serif,Georgia,serif', copy.loadTitle);
  const status = el('p', 'margin:0;font:13px/1.4 ui-serif,Georgia,serif;display:none');
  status.setAttribute('role', 'status');
  const setStatus = (text: string | null): void => {
    status.textContent = text ?? '';
    status.style.display = text === null ? 'none' : 'block';
  };
  const run = flowRunner(setStatus);

  let selected: SaveSlotInfo | null = null;
  let selectedRow: HTMLButtonElement | null = null;
  /** Buttons meaningless without a selected row; disabled until one is picked. */
  const selectionActions: HTMLButtonElement[] = [];

  const list = slotList(deps.saveLoad, setStatus, (slot, row) => {
    row.addEventListener('click', () => {
      if (selectedRow !== null) selectedRow.style.background = ROW_BACKGROUND;
      selected = slot;
      selectedRow = row;
      row.style.background = SELECTED_ROW_BACKGROUND;
      for (const button of selectionActions) button.disabled = false;
      setStatus(null);
    });
    row.addEventListener('dblclick', () => loadSelected());
  });

  const refresh = async (): Promise<void> => {
    selected = null;
    selectedRow = null;
    for (const button of selectionActions) button.disabled = true;
    await list.refresh(await worldNameIndex());
  };

  const loadSelected = (): void =>
    run(async () => {
      if (selected === null) return null;
      const slot = selected;
      // Loading replaces the running session, so it asks like the other destructive actions.
      const confirmed = await confirmDialog({
        message: formatMessage(copy.loadConfirm, { name: slot.name }),
        confirmLabel: copy.load,
        cancelLabel: copy.cancel,
      });
      if (!confirmed) return null;
      const outcome = await deps.saveLoad.loadSave(slot.id);
      return outcome.kind === 'rejected' ? hud.loadErrors[outcome.reason] : null;
    });

  const load = el('button', deps.buttonStyle, copy.load);
  load.type = 'button';
  load.disabled = true;
  load.addEventListener('click', loadSelected);
  selectionActions.push(load);

  const del = el('button', deps.buttonStyle, copy.del);
  del.type = 'button';
  del.disabled = true;
  selectionActions.push(del);
  del.addEventListener('click', () =>
    run(async () => {
      if (selected === null) return null;
      const slot = selected;
      const confirmed = await confirmDialog({
        message: formatMessage(copy.deleteConfirm, { name: slot.name }),
        confirmLabel: copy.del,
        cancelLabel: copy.cancel,
      });
      if (!confirmed) return null;
      try {
        await deps.saveLoad.deleteSave(slot.id);
      } catch {
        return copy.deleteFailed;
      }
      await refresh();
      return copy.deleted;
    }),
  );

  const fromFile = el('button', deps.buttonStyle, copy.fromFile);
  fromFile.type = 'button';
  fromFile.addEventListener('click', () =>
    run(async () => {
      const outcome = await deps.saveLoad.loadFromFile();
      return outcome.kind === 'rejected' ? hud.loadErrors[outcome.reason] : null;
    }),
  );

  // Exactly one of the two backup paths exists: the desktop reveals its saves folder, the browser
  // exports the selected slot as a download.
  const folderOrExport =
    deps.saveLoad.showFolder !== null
      ? (() => {
          const show = deps.saveLoad.showFolder;
          const button = el('button', deps.buttonStyle, copy.showFolder);
          button.type = 'button';
          button.addEventListener('click', () =>
            run(async () => {
              try {
                await show();
                return null;
              } catch {
                return copy.showFolderFailed;
              }
            }),
          );
          return button;
        })()
      : (() => {
          const button = el('button', deps.buttonStyle, copy.export);
          button.type = 'button';
          button.disabled = true;
          selectionActions.push(button);
          button.addEventListener('click', () =>
            run(async () => {
              if (selected === null) return null;
              const outcome = await deps.saveLoad.exportSave(selected.id);
              return outcome.kind === 'failed' ? copy.exportFailed : null;
            }),
          );
          return button;
        })();

  const back = el('button', deps.buttonStyle, copy.back);
  back.type = 'button';
  back.addEventListener('click', deps.showMenu);

  const actions = el('div', 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end');
  actions.append(load, del, fromFile, folderOrExport, back);
  panel.append(title, list.box, actions, status);

  return {
    el: panel,
    open(): void {
      setStatus(null);
      void refresh();
    },
  };
}
