import { initialMapSelectMemory, type MapSelectItem } from '../map-select-model.js';
import { type CreateChoice, createRoomCard } from './create-card.js';
import { roomMapPick } from './map-pick.js';

interface CreatePanelOptions {
  readonly create: (choice: CreateChoice) => Promise<void>;
  /** Puts the map list in the browser's place, or the browser back. */
  readonly showMapList: (on: boolean) => void;
}

/** The create-room card and the map list it opens; the list stays inside the screen because leaving
 *  the screen drops the relay connection. */
export function createPanel(options: CreatePanelOptions) {
  const card = createRoomCard({ create: options.create, pickMap: () => showMapList(true) });
  const memory = initialMapSelectMemory();
  let chosen: MapSelectItem | null = null;
  const choose = (item: MapSelectItem | null): void => {
    chosen = item;
    card.setMap(item);
  };
  const mapList = roomMapPick({
    memory,
    onChoose(item) {
      choose(item);
      showMapList(false);
    },
    onBack: () => showMapList(false),
    onMaps: (maps) => choose(maps.find((map) => map.id === memory.selectedId) ?? maps[0] ?? null),
  });
  function showMapList(on: boolean): void {
    options.showMapList(on);
    mapList.element.hidden = !on;
    // A row browsed and then abandoned must not outlive the card's choice.
    if (!on && chosen !== null) mapList.select(chosen.id);
    // Hiding the focused control drops focus to <body>, where Esc would read as menu navigation.
    if (on) mapList.element.querySelector<HTMLButtonElement>('button')?.focus();
    else card.mapControl.focus();
  }
  return {
    card: card.element,
    mapList: mapList.element,
    enable: card.enable,
    dispose: card.dispose,
    /** True when the map list was open and is now closed. */
    closeMapList(): boolean {
      if (mapList.element.hidden) return false;
      showMapList(false);
      return true;
    },
  };
}
