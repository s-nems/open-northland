import type { MapsIndexEntry } from '@open-northland/content-resolver/wire';
import { MAX_ROOM_NAME_LENGTH } from '@open-northland/net-protocol';
import { loadMapList } from '../../../content/maps-index.js';
import { errorText } from '../../../diag/error-text.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { platformSavePicker } from '../../../view/runtime/save-load/file-access.js';
import { createSaveStore } from '../../../view/runtime/save-load/store.js';
import { SCENE_TOKEN_PREFIX } from '../../../view/runtime/save-load/world-names.js';
import { button, field, node } from './parts.js';

export type CreateChoice =
  | { readonly kind: 'map'; readonly map: MapsIndexEntry; readonly name: string }
  | { readonly kind: 'save'; readonly bytes: SaveBytes; readonly name: string };

export function createRoomCard(create: (choice: CreateChoice) => Promise<void>) {
  const copy = messages().network;
  const element = node('form', 'network-menu__create');
  const name = node('input');
  name.maxLength = MAX_ROOM_NAME_LENGTH;
  name.required = true;
  name.value = copy.defaultRoomName;
  const map = node('select');
  const save = node('select');
  const mode = node('select');
  mode.append(new Option(copy.fromMap, 'map'), new Option(copy.fromSave, 'save'));
  const saveField = field(copy.save, save);
  const mapField = field(copy.map, map);
  const status = node('p', 'network-menu__notice');
  status.setAttribute('role', 'status');
  const store = createSaveStore();
  let maps: readonly MapsIndexEntry[] = [];
  let disposed = false;
  let enabled = true;
  let busy = false;
  const sync = (): void => {
    saveField.hidden = mode.value !== 'save';
    mapField.hidden = mode.value !== 'map';
    file.hidden = mode.value !== 'save';
    for (const input of [mode, name, map, save, file]) input.disabled = !enabled || busy;
    submit.disabled =
      !enabled || busy || (mode.value === 'map' ? maps.length === 0 : save.options.length === 0);
  };
  const run = async (read: () => Promise<CreateChoice | null>): Promise<void> => {
    if (!enabled || busy || disposed || !element.reportValidity()) return;
    busy = true;
    sync();
    status.textContent = copy.preparing;
    try {
      const choice = await read();
      if (!disposed && choice !== null) await create(choice);
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
      const picked = await platformSavePicker()();
      return picked === null ? null : { kind: 'save', bytes: picked.raw, name: name.value.trim() };
    });
  });
  const submit = node('button', 'main-menu__primary', copy.create);
  submit.type = 'submit';
  element.addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
      if (mode.value === 'map') {
        const selected = maps.find((item) => item.id === map.value);
        return selected === undefined ? null : { kind: 'map', map: selected, name: name.value.trim() };
      }
      const bytes = await store.read(save.value);
      if (bytes === null) throw new Error(copy.saveInvalid);
      return { kind: 'save', bytes, name: name.value.trim() };
    });
  });
  mode.addEventListener('change', () => {
    sync();
    status.textContent =
      mode.value === 'save' && save.options.length === 0
        ? copy.noSaves
        : mode.value === 'map' && maps.length === 0
          ? copy.noMaps
          : '';
  });
  element.append(
    node('h2', '', copy.create),
    field(copy.roomName, name),
    field(copy.source, mode),
    mapField,
    saveField,
    file,
    submit,
    status,
  );
  void Promise.allSettled([loadMapList(), store.list()])
    .then(([mapResult, saveResult]) => {
      if (disposed) return;
      const items = mapResult.status === 'fulfilled' ? mapResult.value : [];
      const slots = saveResult.status === 'fulfilled' ? saveResult.value : [];
      maps = items.filter((item) => item.players?.some((slot) => slot.claimable && !slot.hidden));
      map.replaceChildren(...maps.map((item) => new Option(item.name ?? item.id, item.id)));
      save.replaceChildren(
        ...slots
          .filter((slot) => slot.mapId !== null && !slot.mapId.startsWith(SCENE_TOKEN_PREFIX))
          .map((slot) => new Option(slot.name, slot.id)),
      );
      if (maps.length === 0) status.textContent = copy.noMaps;
      sync();
      const rejected = [mapResult, saveResult].find((result) => result.status === 'rejected');
      if (rejected?.status === 'rejected')
        status.textContent = formatMessage(copy.failed, { reason: errorText(rejected.reason) });
    })
    .catch((error: unknown) => {
      if (!disposed) status.textContent = formatMessage(copy.failed, { reason: errorText(error) });
    });
  sync();
  return {
    element,
    enable(value: boolean) {
      enabled = value;
      sync();
    },
    dispose() {
      disposed = true;
    },
  };
}
