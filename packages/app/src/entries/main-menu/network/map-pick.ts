import { messages } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { hasClaimableSeat } from '../lobby/roster-state.js';
import { mapPicker } from '../map-picker.js';
import { type MapSelectItem, type MapSelectMemory, ROOM_TABS } from '../map-select-model.js';

interface MapPickOptions {
  readonly memory: MapSelectMemory;
  readonly onChoose: (item: MapSelectItem) => void;
  readonly onBack: () => void;
  readonly onMaps: (maps: readonly MapSelectItem[]) => void;
}

/** The New Game map list under the room listing, with a way back to the create card. */
export function roomMapPick(options: MapPickOptions) {
  const copy = messages();
  const element = node('div', 'network-menu__pick');
  element.hidden = true;
  const head = node('div', 'main-menu__screen-head');
  const back = node('button', 'main-menu__back', `← ${copy.mainMenu.screenTitles.multiplayer}`);
  back.type = 'button';
  back.addEventListener('click', options.onBack);
  const title = node('h1', 'main-menu__screen-title', copy.network.chooseMap);
  const tools = node('div', 'main-menu__head-tools');
  const picker = mapPicker({
    memory: options.memory,
    listing: 'multiplayer',
    tabs: ROOM_TABS,
    // A room needs a seat for its creator; the original's list does not look at the roster.
    include: (item) => hasClaimableSeat(item.players),
    primaryLabel: () => copy.network.choose,
    onPrimary: options.onChoose,
    onMaps: options.onMaps,
  });
  tools.append(picker.tabs);
  head.append(back, title, tools);
  element.append(head, picker.body);
  return { element, select: picker.select };
}
