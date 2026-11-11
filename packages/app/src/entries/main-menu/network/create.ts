import { initialMapSelectMemory, type MapSelectItem } from '../map-select/model.js';
import { type CreateChoice, createRoomCard } from './create-card.js';
import { roomMapPick } from './map-pick.js';
import { keptRoomSave, type RoomSave, roomSavePick } from './save-pick.js';

type Picker = 'map' | 'save';

interface CreatePanelOptions {
  readonly create: (choice: CreateChoice) => Promise<void>;
  /** Puts a list in the browser's place, or the browser back. */
  readonly showPicker: (on: boolean) => void;
}

/** The create-room card and the map and save lists it opens; the lists stay inside the screen because
 *  leaving the screen drops the relay connection. */
export function createPanel(options: CreatePanelOptions) {
  const card = createRoomCard({
    create: options.create,
    pickMap: () => showPicker('map'),
    pickSave: () => showPicker('save'),
  });
  const memory = initialMapSelectMemory('all');
  let chosen: MapSelectItem | null = null;
  const choose = (item: MapSelectItem | null): void => {
    chosen = item;
    card.setMap(item);
  };
  const mapList = roomMapPick({
    memory,
    onChoose(item) {
      choose(item);
      showPicker(null);
    },
    onBack: () => showPicker(null),
    onMaps: (maps) => choose(maps.find((map) => map.id === memory.selectedId) ?? maps[0] ?? null),
  });
  let chosenSave: RoomSave | null = null;
  const chooseSave = (save: RoomSave | null): void => {
    chosenSave = save;
    card.setSave(save);
  };
  const saveList = roomSavePick({
    onChoose(save) {
      chooseSave(save);
      showPicker(null);
    },
    onBack: () => showPicker(null),
    onSaves: (slots) => chooseSave(keptRoomSave(chosenSave, slots)),
  });
  let open: Picker | null = null;
  function showPicker(next: Picker | null): void {
    const from = open;
    open = next;
    options.showPicker(next !== null);
    mapList.element.hidden = next !== 'map';
    saveList.element.hidden = next !== 'save';
    // A row browsed and then abandoned must not outlive the card's choice.
    if (from === 'map' && chosen !== null) mapList.select(chosen.id);
    if (from === 'save') saveList.select(chosenSave?.kind === 'slot' ? chosenSave.slot.id : null);
    // Hiding the focused control drops focus to <body>, where Esc would read as menu navigation.
    if (next === 'map') mapList.element.querySelector<HTMLButtonElement>('button')?.focus();
    else if (next === 'save') saveList.focus();
    else if (from === 'map') card.mapControl.focus();
    else if (from === 'save') card.saveControl.focus();
  }
  return {
    card: card.element,
    pickers: [mapList.element, saveList.element],
    enable: card.enable,
    dispose(): void {
      card.dispose();
      mapList.dispose();
      saveList.dispose();
    },
    /** Closes the catalogue and the list over the browser. */
    resetPickers(): void {
      mapList.closeCatalogue();
      if (open !== null) showPicker(null);
    },
    /** True when a list (or the catalogue over the map list) was open and is now closed. */
    closePicker(): boolean {
      if (open === null) return false;
      mapList.closeCatalogue();
      showPicker(null);
      return true;
    },
  };
}
