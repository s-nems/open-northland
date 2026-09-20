import { messages } from '../../i18n/index.js';
import type { LaunchEntry } from '../../launch.js';
import { initialLobbyOptions, initialLobbyState, lobbyStartEntry } from './lobby/model.js';
import { mapPicker } from './map-picker.js';
import { type MapSelectItem, type MapSelectMemory, SINGLE_PLAYER_TABS } from './map-select-model.js';
import type { MenuScreen } from './model.js';
import { screenHead } from './screen-head.js';
import { targetSearch } from './target-search.js';

/** Free-play maps continue to the lobby; tutorials and test scenes start with their safe defaults. */
export function mapSelectScreen(
  open: (screen: MenuScreen) => void,
  memory: MapSelectMemory,
  openLobby: (item: MapSelectItem) => void,
  launch: LaunchEntry,
): HTMLElement {
  const select = messages().mainMenu.mapSelect;
  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__map-select';
  const head = screenHead('newGame', open);
  const tools = document.createElement('div');
  tools.className = 'main-menu__head-tools';
  const picker = mapPicker({
    memory,
    listing: 'single',
    tabs: SINGLE_PLAYER_TABS,
    primaryLabel: (item) =>
      item.kind === 'scene' ? select.run : item.tutorialStep !== undefined ? select.startLesson : select.next,
    onPrimary: (item) => {
      // targetSearch carries the sticky menu params (lang, sound, ...).
      if (item.kind === 'scene') launch(targetSearch(`?scene=${encodeURIComponent(item.id)}`));
      else if (item.tutorialStep !== undefined) {
        const state = initialLobbyState(item.players);
        const options = initialLobbyOptions(new URLSearchParams(window.location.search));
        launch(targetSearch(lobbyStartEntry(item.id, state, item.players, options)));
      } else openLobby(item);
    },
  });
  tools.append(picker.tabs);
  head.append(tools);
  section.append(head, picker.body);
  return section;
}
