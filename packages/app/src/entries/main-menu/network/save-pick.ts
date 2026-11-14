import { apiBaseUrl, playableMapSources } from '../../../content/map-source/index.js';
import { GLYPH } from '../../../hud/dom/icons.js';
import { button } from '../../../hud/dom/parts/dom.js';
import { messages } from '../../../i18n/index.js';
import type { SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { pickSaveFile } from '../../../view/runtime/save-load/file-access.js';
import type { SaveSlotInfo } from '../../../view/runtime/save-load/store.js';
import { node } from '../dom.js';
import { type MapSelectItem, mapSourceItem } from '../map-select/model.js';
import { menuSavesPanel } from '../saves/panel.js';
import { isRoomMap } from './map-pick.js';

/** The save a room starts from: a stored save on a multiplayer map, or any save file the creator picks. */
export type RoomSave =
  | { readonly kind: 'slot'; readonly slot: SaveSlotInfo }
  | { readonly kind: 'file'; readonly name: string; readonly bytes: SaveBytes };

/** The saves a room can start from: those on a map a room can be made on. A save taken alone on a
 *  multiplayer map restores into a room as a relayed game's does, seated from its launch search. Map ids
 *  match without case, as the map registry finds them. */
function roomSaves(slots: readonly SaveSlotInfo[], maps: readonly MapSelectItem[]): readonly SaveSlotInfo[] {
  const roomMaps = new Set(maps.filter(isRoomMap).map((map) => map.id.toLowerCase()));
  return slots.filter((slot) => slot.mapId !== null && roomMaps.has(slot.mapId.toLowerCase()));
}

async function playableMaps(): Promise<readonly MapSelectItem[]> {
  const api = apiBaseUrl();
  return (await playableMapSources()).map((source) => mapSourceItem(source, api));
}

/** The save a room keeps once the list is drawn again: a picked file, or the picked slot while the list
 *  still holds it, else the newest listed save. */
export function keptRoomSave(chosen: RoomSave | null, slots: readonly SaveSlotInfo[]): RoomSave | null {
  if (chosen?.kind === 'file') return chosen;
  const keptId = chosen?.kind === 'slot' ? chosen.slot.id : null;
  const slot = slots.find((listed) => listed.id === keptId) ?? slots[0];
  return slot === undefined ? null : { kind: 'slot', slot };
}

interface SavePickOptions {
  readonly onChoose: (save: RoomSave) => void;
  readonly onBack: () => void;
  /** The offered saves, newest first, each time the list is drawn. */
  readonly onSaves: (slots: readonly SaveSlotInfo[]) => void;
}

/** The stored saves on multiplayer maps in place of the room listing, which leaving the screen would
 *  drop with the relay connection, and the way back to the create card with a choice or without. */
export function roomSavePick(options: SavePickOptions) {
  const copy = messages().network;
  const element = node('div', 'network-menu__pick');
  element.hidden = true;
  const head = node('div', 'main-menu__screen-head');
  const back = node('button', 'main-menu__back', `← ${messages().mainMenu.screenTitles.multiplayer}`);
  back.type = 'button';
  back.addEventListener('click', options.onBack);
  head.append(back, node('h1', 'main-menu__screen-title', copy.chooseSave));

  const choose = button('on-button on-button--primary', GLYPH.next);
  choose.append(copy.choose);
  choose.disabled = true;
  const fromFile = button('on-button', GLYPH.upload);
  fromFile.append(copy.file);
  const panel = menuSavesPanel({
    offered: async (slots) => roomSaves(slots, await playableMaps()),
    emptyHint: copy.noSavesHint,
    onSelect: (slot) => {
      choose.disabled = slot === null;
    },
    onActivate: (slot) => options.onChoose({ kind: 'slot', slot }),
    onListed: options.onSaves,
  });
  panel.leading.append(fromFile);
  panel.actions.append(choose);
  choose.addEventListener('click', () => {
    const slot = panel.browser.sheet.selected();
    if (slot !== null) options.onChoose({ kind: 'slot', slot });
  });
  fromFile.addEventListener('click', () =>
    panel.run(async () => {
      const picked = await pickSaveFile();
      if (picked !== null) options.onChoose({ kind: 'file', name: picked.name, bytes: picked.raw });
      return null;
    }),
  );
  element.append(head, panel.element);

  void panel.refresh();
  return {
    element,
    select: panel.browser.sheet.select,
    focus(): void {
      if (!panel.browser.sheet.focus()) back.focus();
    },
    dispose: panel.dispose,
  };
}
