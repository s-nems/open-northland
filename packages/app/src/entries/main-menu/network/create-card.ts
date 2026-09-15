import { MAX_ROOM_NAME_LENGTH } from '@open-northland/net-protocol';
import { errorText } from '../../../diag/error-text.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { pickSaveFile } from '../../../view/runtime/save-load/file-access.js';
import { browserSaveStore } from '../../../view/runtime/save-load/store-browser.js';
import { SCENE_TOKEN_PREFIX } from '../../../view/runtime/save-load/world-names.js';
import { segControl } from '../../../view/settings-controls.js';
import { metaLine } from '../map-card.js';
import type { MapSelectItem } from '../map-select-model.js';
import { button, field, node } from './parts.js';

export type CreateChoice =
  | { readonly kind: 'map'; readonly mapId: string; readonly name: string }
  | { readonly kind: 'save'; readonly bytes: SaveBytes; readonly name: string };

type Source = 'map' | 'save';

interface CreateCardOptions {
  readonly create: (choice: CreateChoice) => Promise<void>;
  /** Opens the map list; the choice comes back through `setMap`. */
  readonly pickMap: () => void;
}

export function createRoomCard(options: CreateCardOptions) {
  const copy = messages().network;
  const element = node('form', 'network-menu__create');
  const name = node('input');
  name.maxLength = MAX_ROOM_NAME_LENGTH;
  name.required = true;
  name.value = copy.defaultRoomName;
  let source: Source = 'map';
  const mode = segControl<Source>(
    [
      { id: 'map', label: copy.fromMap },
      { id: 'save', label: copy.fromSave },
    ],
    source,
    (next) => {
      source = next;
      mode.setActive(next);
      sync();
      status.textContent =
        source === 'save' && save.options.length === 0
          ? copy.noSaves
          : source === 'map' && mapsEmpty
            ? copy.noMaps
            : '';
    },
  );
  const save = node('select');
  const saveField = field(copy.save, save);
  const mapRow = node('div', 'network-menu__map-pick');
  const thumb = node('div', 'main-menu__map-thumb');
  const mapText = node('div', 'network-menu__map-pick-text');
  const mapName = node('div', 'main-menu__map-row-name', messages().mainMenu.mapSelect.loading);
  const mapMeta = node('div', 'main-menu__map-row-meta');
  mapText.append(mapName, mapMeta);
  const change = button(copy.changeMap, options.pickMap);
  mapRow.append(thumb, mapText, change);
  // Not a `field()`: a label would hand a click on the thumb or the name to the button.
  const mapField = node('div', 'network-menu__field');
  mapField.append(node('span', '', copy.map), mapRow);
  const status = node('p', 'network-menu__notice');
  status.setAttribute('role', 'status');
  const store = browserSaveStore();
  let chosen: MapSelectItem | null = null;
  let mapsEmpty = false;
  let disposed = false;
  let enabled = true;
  let busy = false;
  const sync = (): void => {
    saveField.hidden = source !== 'save';
    mapField.hidden = source !== 'map';
    file.hidden = source !== 'save';
    for (const input of [name, save, file, change]) input.disabled = !enabled || busy;
    for (const segment of mode.root.querySelectorAll('button')) segment.disabled = !enabled || busy;
    submit.disabled = !enabled || busy || (source === 'map' ? chosen === null : save.options.length === 0);
  };
  const run = async (read: () => Promise<CreateChoice | null>): Promise<void> => {
    if (!enabled || busy || disposed || !element.reportValidity()) return;
    busy = true;
    sync();
    status.textContent = copy.preparing;
    try {
      const choice = await read();
      if (!disposed && choice !== null) await options.create(choice);
      if (!disposed) status.textContent = '';
    } catch (error) {
      if (!disposed) status.textContent = formatMessage(copy.failed, { reason: errorText(error) });
    } finally {
      busy = false;
      if (!disposed) sync();
    }
  };
  const file = button(copy.file, () => {
    void run(async () => {
      const picked = await pickSaveFile();
      return picked === null ? null : { kind: 'save', bytes: picked.raw, name: name.value.trim() };
    });
  });
  const submit = node('button', 'main-menu__primary', copy.create);
  submit.type = 'submit';
  element.addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
      if (source === 'map')
        return chosen === null ? null : { kind: 'map', mapId: chosen.id, name: name.value.trim() };
      const bytes = await store.read(save.value);
      if (bytes === null) throw new Error(copy.saveInvalid);
      return { kind: 'save', bytes, name: name.value.trim() };
    });
  });
  element.append(
    node('h2', '', copy.create),
    field(copy.roomName, name),
    field(copy.source, mode.root),
    mapField,
    saveField,
    file,
    submit,
    status,
  );
  void store
    .list()
    .then((slots) => {
      if (disposed) return;
      save.replaceChildren(
        ...slots
          .filter((slot) => slot.mapId !== null && !slot.mapId.startsWith(SCENE_TOKEN_PREFIX))
          .map((slot) => new Option(slot.name, slot.id)),
      );
      sync();
    })
    .catch((error: unknown) => {
      if (!disposed) status.textContent = formatMessage(copy.failed, { reason: errorText(error) });
    });
  sync();
  return {
    element,
    mapControl: change,
    enable(value: boolean) {
      enabled = value;
      sync();
    },
    /** The map the room will play; null once the list has loaded with nothing playable. */
    setMap(item: MapSelectItem | null) {
      chosen = item;
      mapsEmpty = item === null;
      mapName.textContent = item?.title ?? copy.noMaps;
      mapMeta.textContent = item === null ? '' : metaLine(item);
      thumb.replaceChildren();
      if (item?.minimap) {
        const img = document.createElement('img');
        img.src = `/maps/${encodeURIComponent(item.id)}.png`;
        img.alt = '';
        thumb.append(img);
      }
      if (source === 'map') status.textContent = item === null ? copy.noMaps : '';
      sync();
    },
    dispose() {
      disposed = true;
    },
  };
}
