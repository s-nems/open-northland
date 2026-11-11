import { installedMapStore } from '../../../content/map-source/store.js';
import { messages } from '../../../i18n/index.js';
import { localImportControls } from '../catalogue/local-import.js';
import { type CatalogueView, catalogueView, initialCatalogueMemory } from '../catalogue/view.js';
import { node } from '../dom.js';
import { hasClaimableSeat } from '../lobby/roster-state.js';
import { listedIn, type MapSelectItem, type MapSelectMemory, ROOM_TABS } from '../map-select/model.js';
import { mapPicker } from '../map-select/picker.js';

interface MapPickOptions {
  readonly memory: MapSelectMemory;
  readonly onChoose: (item: MapSelectItem) => void;
  readonly onBack: () => void;
  readonly onMaps: (maps: readonly MapSelectItem[]) => void;
}

/** A map a room can be made on: one the multiplayer list takes, with a seat for the room's creator, which
 *  the original's list does not look for. */
export function isRoomMap(item: MapSelectItem): boolean {
  return listedIn(item, 'multiplayer') && hasClaimableSeat(item.players);
}

/** The New Game map list under the room listing, with a way back to the create card, and the map
 *  catalogue in its place, since leaving the screen would drop the relay connection. Both lead back to
 *  the create card: with the chosen map, or without a change on back. */
export function roomMapPick(options: MapPickOptions) {
  const copy = messages();
  const element = node('div', 'network-menu__pick');
  element.hidden = true;
  const head = node('div', 'main-menu__screen-head');
  const back = node('button', 'main-menu__back', `← ${copy.mainMenu.screenTitles.multiplayer}`);
  back.type = 'button';
  const title = node('h1', 'main-menu__screen-title', copy.network.chooseMap);
  const tools = node('div', 'main-menu__head-tools');
  const picker = mapPicker({
    memory: options.memory,
    listing: 'multiplayer',
    tabs: ROOM_TABS,
    include: isRoomMap,
    primaryLabel: () => copy.network.choose,
    onPrimary: options.onChoose,
    onMaps: options.onMaps,
  });
  const catalogueMemory = initialCatalogueMemory();
  catalogueMemory.query = { ...catalogueMemory.query, kind: 'multi' };
  let catalogue: CatalogueView | null = null;
  const openButton = node('button', 'main-menu__ghost catalogue__open', copy.mapCatalogue.open);
  openButton.type = 'button';
  const importArea = node('div', 'network-menu__import');
  const store = installedMapStore();
  const imports =
    store === null
      ? null
      : localImportControls({
          store,
          target: element,
          enabled: () => catalogue === null && !element.hidden,
          onBusyChange: (busy) => {
            openButton.disabled = busy;
          },
          manage: () => {
            catalogueMemory.tab = 'installed';
            openCatalogue();
          },
          changed: async (entryId) => {
            picker.reload();
            catalogueMemory.tab = 'installed';
            catalogueMemory.selectedId = entryId;
            if (!element.hidden) openCatalogue();
          },
        });
  if (imports !== null) importArea.append(imports.root);

  function closeCatalogue(): void {
    imports?.closeMenu();
    if (catalogue === null) return;
    catalogue.dispose();
    catalogue.tabs.remove();
    catalogue.count.remove();
    catalogue.body.remove();
    catalogue = null;
    title.textContent = copy.network.chooseMap;
    openButton.hidden = false;
    importArea.hidden = false;
    if (imports !== null) imports.pickers.hidden = false;
    picker.body.hidden = false;
    picker.tabs.hidden = ROOM_TABS.length === 0;
    back.focus();
  }
  function openCatalogue(): void {
    if (catalogue !== null) return;
    imports?.closeMenu();
    importArea.hidden = true;
    if (imports !== null) imports.pickers.hidden = true;
    catalogue = catalogueView({
      memory: catalogueMemory,
      purpose: 'choose',
      onPick(item) {
        closeCatalogue();
        options.onChoose(item);
      },
      onInstalledChanged: picker.reload,
    });
    title.textContent = copy.mapCatalogue.open;
    openButton.hidden = true;
    picker.body.hidden = true;
    picker.tabs.hidden = true;
    tools.append(catalogue.count, catalogue.tabs);
    element.append(catalogue.body);
    back.focus();
  }
  back.addEventListener('click', () => {
    closeCatalogue();
    options.onBack();
  });
  openButton.addEventListener('click', openCatalogue);
  tools.append(openButton);
  if (imports !== null) tools.append(imports.pickers);
  tools.append(picker.tabs);
  head.append(back, title, tools);
  element.append(head, importArea, picker.body);
  return {
    element,
    select: picker.select,
    closeCatalogue,
    dispose(): void {
      catalogue?.dispose();
      imports?.dispose();
    },
  };
}
