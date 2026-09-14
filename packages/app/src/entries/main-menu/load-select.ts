import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import type { LaunchEntry } from '../../launch.js';
import { confirmDialog } from '../../view/confirm-dialog.js';
import { decodeSaveText, type SaveBytes } from '../../view/runtime/save-load/codec.js';
import { downloadStoredSave } from '../../view/runtime/save-load/controller.js';
import { evaluateSaveDocument } from '../../view/runtime/save-load/evaluate.js';
import { type PickedSaveFile, pickSaveFile } from '../../view/runtime/save-load/file-access.js';
import { flowRunner } from '../../view/runtime/save-load/flow-runner.js';
import { formatPlaytime, formatSavedAt } from '../../view/runtime/save-load/list-model.js';
import { storePendingLoad } from '../../view/runtime/save-load/pending-store.js';
import { relaunchSearch } from '../../view/runtime/save-load/relaunch.js';
import type { SaveSlotInfo } from '../../view/runtime/save-load/store.js';
import { browserSaveStore } from '../../view/runtime/save-load/store-browser.js';
import { worldNameIndex } from '../../view/runtime/save-load/world-names.js';
import type { MenuScreen } from './model.js';
import { screenHead } from './screen-head.js';
import { targetSearch } from './target-search.js';

/** The main menu's load screen: the save store's slots, launched into their own worlds. */
export function loadSelectScreen(open: (screen: MenuScreen) => void, launch: LaunchEntry): HTMLElement {
  const copy = messages();
  const listCopy = copy.saveList;
  const errors = copy.hud.loadErrors;
  const store = browserSaveStore();

  const section = document.createElement('section');
  section.className = 'main-menu__screen';
  const head = screenHead('load', open);

  const body = document.createElement('div');
  body.className = 'main-menu__map-body';
  const listCol = document.createElement('div');
  listCol.className = 'main-menu__map-list-col';
  const listScroll = document.createElement('div');
  listScroll.className = 'main-menu__map-scroll';
  const list = document.createElement('div');
  list.className = 'main-menu__map-list';
  listScroll.append(list);

  const status = document.createElement('p');
  status.className = 'main-menu__map-empty';
  status.setAttribute('role', 'status');
  status.hidden = true;
  const setStatus = (text: string | null): void => {
    status.textContent = text ?? '';
    status.hidden = text === null;
  };

  const run = flowRunner(setStatus, listCopy.actionFailed);

  let selected: SaveSlotInfo | null = null;
  const rowButtons = new Map<SaveSlotInfo, HTMLButtonElement>();
  /** Buttons meaningless without a selected row; disabled until one is picked. */
  const selectionActions: HTMLButtonElement[] = [];

  const loadButton = document.createElement('button');
  loadButton.type = 'button';
  loadButton.className = 'main-menu__primary';
  loadButton.textContent = listCopy.load;
  loadButton.disabled = true;
  selectionActions.push(loadButton);

  const selectSlot = (slot: SaveSlotInfo): void => {
    selected = slot;
    for (const [rowSlot, button] of rowButtons) {
      button.classList.toggle('is-selected', rowSlot === slot);
      button.setAttribute('aria-pressed', String(rowSlot === slot));
      // Roving tabindex: the selected row is the list's only tab stop; arrows walk the rest.
      button.tabIndex = rowSlot === slot ? 0 : -1;
    }
    for (const button of selectionActions) button.disabled = false;
  };

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const entries = [...rowButtons.entries()];
    const index = entries.findIndex(([slot]) => slot === selected);
    const next = entries[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next !== undefined) {
      selectSlot(next[0]);
      next[1].focus();
    }
  });

  /** Set once a save is staged: the entry downloading behind the screen owns those bytes, and a
   *  second hand-off would swap them under it. */
  let handedOff = false;

  /** Validate, stage, and hand the document to the save's own entry; a returned string is the
   *  rejection to show. */
  const stageAndLaunch = async (contents: string, raw: SaveBytes): Promise<string | null> => {
    if (handedOff) return null;
    const evaluated = evaluateSaveDocument(contents);
    if (!evaluated.ok) return errors[evaluated.reason];
    const search = relaunchSearch(evaluated.save.header);
    if (search === null) return errors.corrupt;
    try {
      await storePendingLoad(raw);
    } catch {
      return errors.storage;
    }
    handedOff = true;
    launch(targetSearch(search));
    return null;
  };

  const loadSelected = (): void =>
    run(async () => {
      if (selected === null) return null;
      const bytes = await store.read(selected.id).catch(() => null);
      if (bytes === null) return errors.missing;
      let contents: string;
      try {
        contents = await decodeSaveText(bytes);
      } catch {
        return errors.corrupt;
      }
      return stageAndLaunch(contents, bytes);
    });
  loadButton.addEventListener('click', loadSelected);

  const slotRow = (slot: SaveSlotInfo, worldName: string | null): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__map-row';
    const text = document.createElement('div');
    text.className = 'main-menu__map-row-text';
    const rowName = document.createElement('div');
    rowName.className = 'main-menu__map-row-name';
    rowName.textContent = slot.name;
    const rowMeta = document.createElement('div');
    rowMeta.className = 'main-menu__map-row-meta';
    const playtime = slot.tick !== null ? formatPlaytime(slot.tick) : '-';
    rowMeta.textContent = `${worldName ?? '-'} · ${playtime} · ${formatSavedAt(slot.savedAt, bcp47Tag())}`;
    text.append(rowName, rowMeta);
    button.append(text);
    button.addEventListener('click', () => selectSlot(slot));
    button.addEventListener('dblclick', loadSelected);
    return button;
  };

  /** Only the newest refresh may draw its rows, so a slower earlier one cannot list slots the store
   *  has already moved past. */
  let refreshes = 0;
  const refresh = async (): Promise<void> => {
    const mine = ++refreshes;
    selected = null;
    for (const button of selectionActions) button.disabled = true;
    rowButtons.clear();
    let slots: readonly SaveSlotInfo[];
    try {
      slots = await store.list();
    } catch {
      list.replaceChildren();
      setStatus(listCopy.listFailed);
      return;
    }
    if (mine !== refreshes) return;
    if (slots.length === 0) {
      const notice = document.createElement('p');
      notice.className = 'main-menu__map-empty';
      notice.textContent = listCopy.empty;
      list.replaceChildren(notice);
      return;
    }
    const worldName = await worldNameIndex();
    if (mine !== refreshes) return;
    for (const slot of slots) rowButtons.set(slot, slotRow(slot, worldName(slot.mapId)));
    list.replaceChildren(...rowButtons.values());
  };

  const ghost = (label: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__ghost';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };

  const deleteButton = ghost(listCopy.del, () =>
    run(async () => {
      if (selected === null) return null;
      const slot = selected;
      const confirmed = await confirmDialog({
        message: formatMessage(listCopy.deleteConfirm, { name: slot.name }),
        confirmLabel: listCopy.del,
        cancelLabel: listCopy.cancel,
      });
      if (!confirmed) return null;
      try {
        await store.remove(slot.id);
      } catch {
        return listCopy.deleteFailed;
      }
      await refresh();
      return listCopy.deleted;
    }),
  );

  const fromFile = ghost(listCopy.fromFile, () =>
    run(async () => {
      let picked: PickedSaveFile | null;
      try {
        picked = await pickSaveFile();
      } catch {
        return errors.corrupt;
      }
      if (picked === null) return null;
      return stageAndLaunch(picked.contents, picked.raw);
    }),
  );

  deleteButton.disabled = true;
  selectionActions.push(deleteButton);

  const actions = document.createElement('div');
  actions.className = 'main-menu__load-actions';
  const download = ghost(listCopy.export, () =>
    run(async () => {
      if (selected === null) return null;
      const slot = selected;
      try {
        return (await downloadStoredSave(store, slot.id)) === 'missing' ? errors.missing : null;
      } catch {
        return listCopy.exportFailed;
      }
    }),
  );
  download.disabled = true;
  selectionActions.push(download);
  actions.append(loadButton, deleteButton, fromFile, download);

  listCol.append(listScroll, actions, status);
  body.append(listCol);
  section.append(head, body);
  void refresh();
  return section;
}
