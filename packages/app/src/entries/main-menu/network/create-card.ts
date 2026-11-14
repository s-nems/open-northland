import type { MapVariantKind } from '@open-northland/data';
import { MAX_ROOM_NAME_LENGTH, MAX_ROOM_PASSWORD_LENGTH } from '@open-northland/net-protocol';
import { errorText } from '../../../diag/error-text.js';
import { quietPasswordField, quietTextField } from '../../../hud/dom/parts/text-field.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { displayNameOf, formatPlaytime } from '../../../view/runtime/save-load/list-model.js';
import { browserSaveStore } from '../../../view/runtime/save-load/store-browser.js';
import { worldNameIndex } from '../../../view/runtime/save-load/world-names.js';
import { segControl } from '../../../view/settings/controls.js';
import { node } from '../dom.js';
import { mapVariantToggles } from '../lobby-controls/variant.js';
import { metaLine, paintMapThumb } from '../map-select/card.js';
import type { MapSelectItem } from '../map-select/model.js';
import { button, field } from './parts.js';
import type { RoomSave } from './save-pick.js';

/** `password`, trimmed, locks the room; it is left out for an open one. */
export type CreateChoice = (
  | {
      readonly kind: 'map';
      readonly mapId: string;
      readonly variant: MapVariantKind | null;
      readonly name: string;
    }
  | { readonly kind: 'save'; readonly bytes: SaveBytes; readonly name: string }
) & { readonly password?: string };

type Source = 'map' | 'save';

/** A field showing the one chosen map or save and the button that opens its list. Not a `field()`: a
 *  label would hand a click on the thumb or the name to the button. */
function pickField(label: string, changeLabel: string, onChange: () => void) {
  const row = node('div', 'network-menu__map-pick');
  const thumb = node('div', 'main-menu__map-thumb');
  const text = node('div', 'network-menu__map-pick-text');
  const name = node('div', 'main-menu__map-row-name', messages().mainMenu.mapSelect.loading);
  const meta = node('div', 'main-menu__map-row-meta');
  text.append(name, meta);
  const change = button(changeLabel, onChange);
  row.append(thumb, text, change);
  const field = node('div', 'network-menu__field');
  field.append(node('span', '', label), row);
  return { field, thumb, name, meta, change };
}

interface CreateCardOptions {
  readonly create: (choice: CreateChoice) => Promise<void>;
  /** Opens the map list; the choice comes back through `setMap`. */
  readonly pickMap: () => void;
  /** Opens the save list; the choice comes back through `setSave`. */
  readonly pickSave: () => void;
}

export function createRoomCard(options: CreateCardOptions) {
  const copy = messages().network;
  const element = node('form', 'network-menu__create');
  const name = quietTextField(node('input'));
  name.maxLength = MAX_ROOM_NAME_LENGTH;
  name.required = true;
  name.value = copy.defaultRoomName;
  const password = quietPasswordField(node('input'));
  password.maxLength = MAX_ROOM_PASSWORD_LENGTH;
  const locked = (): { readonly password?: string } => {
    const value = password.value.trim();
    return value === '' ? {} : { password: value };
  };
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
        source === 'save' && chosenSave === null
          ? copy.noSaves
          : source === 'map' && mapsEmpty
            ? copy.noMaps
            : '';
    },
  );
  const sourceField = node('div', 'network-menu__field');
  sourceField.setAttribute('role', 'group');
  sourceField.setAttribute('aria-label', copy.source);
  sourceField.append(node('span', '', copy.source), mode.root);
  let chosenSave: RoomSave | null = null;
  const savePick = pickField(copy.save, copy.changeSave, options.pickSave);
  // Until the save list answers; a store it cannot read leaves no save to continue.
  savePick.name.textContent = copy.noSaves;
  /** The chosen slot's picture, released when the choice changes. */
  let savePicture: string | null = null;
  const mapPick = pickField(copy.map, copy.changeMap, options.pickMap);
  // The variant toggles of a map that ships variants; empty for any other.
  const variantField = node('div');
  let chosenVariant: MapVariantKind | null = null;
  const status = node('p', 'network-menu__notice');
  status.setAttribute('role', 'status');
  const store = browserSaveStore();
  let chosen: MapSelectItem | null = null;
  let mapsEmpty = false;
  let disposed = false;
  let enabled = true;
  let busy = false;
  const sync = (): void => {
    savePick.field.hidden = source !== 'save';
    mapPick.field.hidden = source !== 'map';
    variantField.hidden = source !== 'map';
    for (const input of [name, password, mapPick.change, savePick.change]) input.disabled = !enabled || busy;
    for (const segment of mode.root.querySelectorAll('button')) segment.disabled = !enabled || busy;
    submit.disabled = !enabled || busy || (source === 'map' ? chosen === null : chosenSave === null);
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
  const submit = node('button', 'main-menu__primary', copy.create);
  submit.type = 'submit';
  element.addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
      if (source === 'map')
        return chosen === null
          ? null
          : { kind: 'map', mapId: chosen.id, variant: chosenVariant, name: name.value.trim(), ...locked() };
      if (chosenSave === null) return null;
      const bytes = chosenSave.kind === 'file' ? chosenSave.bytes : await store.read(chosenSave.slot.id);
      if (bytes === null) throw new Error(copy.saveInvalid);
      return { kind: 'save', bytes, name: name.value.trim(), ...locked() };
    });
  });
  element.append(
    node('h2', '', copy.create),
    field(copy.roomName, name),
    field(copy.roomPassword, password),
    sourceField,
    mapPick.field,
    variantField,
    savePick.field,
    submit,
    status,
  );
  sync();
  /** Only the newest choice may write its map's name. */
  let saveShown = 0;
  return {
    element,
    mapControl: mapPick.change,
    saveControl: savePick.change,
    enable(value: boolean) {
      enabled = value;
      sync();
    },
    /** The map the room will play; null once the list has loaded with nothing playable. */
    setMap(item: MapSelectItem | null) {
      chosen = item;
      mapsEmpty = item === null;
      chosenVariant = null;
      const lobby = messages().mainMenu.lobby;
      variantField.replaceChildren(
        ...(item === null
          ? []
          : mapVariantToggles(
              item.id,
              { names: lobby.variantNames, details: lobby.variantDetails },
              chosenVariant,
              (next) => {
                chosenVariant = next;
              },
            )),
      );
      mapPick.name.textContent = item?.title ?? copy.noMaps;
      mapPick.meta.textContent = item === null ? '' : metaLine(item);
      if (item === null) mapPick.thumb.replaceChildren();
      else paintMapThumb(mapPick.thumb, item);
      if (source === 'map') status.textContent = item === null ? copy.noMaps : '';
      sync();
    },
    /** The save the room will continue; null once the list has loaded without one. */
    setSave(next: RoomSave | null) {
      if (disposed) return;
      const mine = ++saveShown;
      chosenSave = next;
      if (savePicture !== null) URL.revokeObjectURL(savePicture);
      savePicture = null;
      const thumbnail = next?.kind === 'slot' ? next.slot.thumbnail : null;
      if (thumbnail === null) savePick.thumb.replaceChildren();
      else {
        savePicture = URL.createObjectURL(thumbnail);
        const img = node('img', 'network-menu__save-picture');
        img.alt = '';
        img.src = savePicture;
        savePick.thumb.replaceChildren(img);
      }
      savePick.name.textContent =
        next === null ? copy.noSaves : next.kind === 'file' ? displayNameOf(next.name) : next.slot.name;
      savePick.meta.textContent = next?.kind === 'file' ? copy.saveFile : '';
      if (next?.kind === 'slot') {
        const { slot } = next;
        const playtime =
          slot.tick === null
            ? null
            : formatMessage(messages().saveList.playtime, { time: formatPlaytime(slot.tick) });
        void worldNameIndex().then((worldName) => {
          if (disposed || mine !== saveShown) return;
          savePick.meta.textContent = [worldName(slot.mapId), playtime]
            .filter((part) => part !== null)
            .join(' · ');
        });
      }
      if (source === 'save') status.textContent = next === null ? copy.noSaves : '';
      sync();
    },
    dispose() {
      disposed = true;
      if (savePicture !== null) URL.revokeObjectURL(savePicture);
    },
  };
}
