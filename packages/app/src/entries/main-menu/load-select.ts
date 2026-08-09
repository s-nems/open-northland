import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import type { LaunchEntry } from '../../launch.js';
import { decodeSaveText, type SaveBytes } from '../../view/runtime/save-load/codec.js';
import { evaluateSaveDocument } from '../../view/runtime/save-load/evaluate.js';
import { type PickedSaveFile, platformSavePicker } from '../../view/runtime/save-load/file-access.js';
import { flowRunner } from '../../view/runtime/save-load/flow-runner.js';
import { formatPlaytime, formatSavedAt } from '../../view/runtime/save-load/list-model.js';
import { storePendingLoad } from '../../view/runtime/save-load/pending-store.js';
import { createSaveStore, type SaveSlotInfo } from '../../view/runtime/save-load/store.js';
import type { MenuScreen } from './model.js';
import { screenHead } from './screen-head.js';
import { targetSearch } from './target-search.js';

/** World tokens of scene entries; everything else is a decoded map id (`entries/scene.ts`). */
const SCENE_TOKEN_PREFIX = 'scene:';

/** The search that relaunches a save's session: its recorded entry when that selects a world, else
 *  one rebuilt from the world token alone (a v1 save), which loses the seat but boots the world. */
function relaunchSearch(header: {
  readonly mapId: string | null;
  readonly entry: string | null;
}): string | null {
  if (header.entry !== null) {
    const recorded = new URLSearchParams(header.entry.startsWith('?') ? header.entry.slice(1) : header.entry);
    if (recorded.has('map') || recorded.has('scene')) return header.entry;
  }
  if (header.mapId === null) return null;
  return header.mapId.startsWith(SCENE_TOKEN_PREFIX)
    ? `?scene=${encodeURIComponent(header.mapId.slice(SCENE_TOKEN_PREFIX.length))}`
    : `?map=${encodeURIComponent(header.mapId)}`;
}

/** The main menu's load screen: the platform save store's slots, launched into their own worlds. */
export function loadSelectScreen(open: (screen: MenuScreen) => void, launch: LaunchEntry): HTMLElement {
  const copy = messages();
  const listCopy = copy.saveList;
  const errors = copy.hud.loadErrors;
  const store = createSaveStore();
  const pickFile = platformSavePicker();

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

  const run = flowRunner(setStatus);

  let selected: SaveSlotInfo | null = null;
  let armedDelete: string | null = null;
  const rowButtons = new Map<SaveSlotInfo, HTMLButtonElement>();

  const loadButton = document.createElement('button');
  loadButton.type = 'button';
  loadButton.className = 'main-menu__primary';
  loadButton.textContent = listCopy.load;
  loadButton.disabled = true;

  const selectSlot = (slot: SaveSlotInfo): void => {
    selected = slot;
    armedDelete = null;
    for (const [rowSlot, button] of rowButtons) {
      button.classList.toggle('is-selected', rowSlot === slot);
      button.setAttribute('aria-pressed', String(rowSlot === slot));
      button.tabIndex = rowSlot === slot ? 0 : -1;
    }
    loadButton.disabled = false;
  };

  /** Validate, stage, and hand the document to the save's own entry; a returned string is the
   *  rejection to show. */
  const stageAndLaunch = async (contents: string, raw: SaveBytes): Promise<string | null> => {
    const evaluated = evaluateSaveDocument(contents);
    if (!evaluated.ok) return errors[evaluated.reason];
    const search = relaunchSearch(evaluated.save.header);
    if (search === null) return errors.corrupt;
    try {
      await storePendingLoad(raw);
    } catch {
      return errors.storage;
    }
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

  const slotRow = (slot: SaveSlotInfo): HTMLButtonElement => {
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
    rowMeta.textContent = `${slot.mapId ?? '-'} · ${playtime} · ${formatSavedAt(slot.savedAt, bcp47Tag())}`;
    text.append(rowName, rowMeta);
    button.append(text);
    button.addEventListener('click', () => selectSlot(slot));
    button.addEventListener('dblclick', loadSelected);
    return button;
  };

  const refresh = async (): Promise<void> => {
    selected = null;
    armedDelete = null;
    loadButton.disabled = true;
    rowButtons.clear();
    let slots: readonly SaveSlotInfo[];
    try {
      slots = await store.list();
    } catch {
      list.replaceChildren();
      setStatus(listCopy.listFailed);
      return;
    }
    if (slots.length === 0) {
      const notice = document.createElement('p');
      notice.className = 'main-menu__map-empty';
      notice.textContent = listCopy.empty;
      list.replaceChildren(notice);
      return;
    }
    for (const slot of slots) rowButtons.set(slot, slotRow(slot));
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
      if (armedDelete !== slot.id) {
        armedDelete = slot.id;
        return formatMessage(listCopy.deleteArm, { name: slot.name });
      }
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
        picked = await pickFile();
      } catch {
        return errors.corrupt;
      }
      if (picked === null) return null;
      return stageAndLaunch(picked.contents, picked.raw);
    }),
  );

  const actions = document.createElement('div');
  actions.className = 'main-menu__load-actions';
  actions.append(loadButton, deleteButton, fromFile);
  const showFolder = store.showFolder;
  if (showFolder !== null) {
    actions.append(
      ghost(listCopy.showFolder, () =>
        run(async () => {
          try {
            await showFolder();
            return null;
          } catch {
            return listCopy.showFolderFailed;
          }
        }),
      ),
    );
  }

  listCol.append(listScroll, actions, status);
  body.append(listCol);
  section.append(head, body);
  void refresh();
  return section;
}
