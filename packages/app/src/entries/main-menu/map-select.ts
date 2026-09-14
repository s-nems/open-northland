import { messages } from '../../i18n/index.js';
import type { LaunchEntry } from '../../launch.js';
import { mapPicker } from './map-picker.js';
import { type MapSelectItem, type MapSelectMemory, SINGLE_PLAYER_TABS } from './map-select-model.js';
import type { MenuScreen } from './model.js';
import { screenHead } from './screen-head.js';
import { targetSearch } from './target-search.js';

/** Maps continue to the lobby; a test scene starts directly, having no roster to negotiate. */
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
    primaryLabel: (item) => (item.kind === 'map' ? select.next : select.run),
    onPrimary: (item) => {
      // targetSearch carries the sticky menu params (lang, sound, ...).
      if (item.kind === 'scene') launch(targetSearch(`?scene=${encodeURIComponent(item.id)}`));
      else openLobby(item);
    },
  });
  tools.append(picker.tabs);
  head.append(tools);
  section.append(head, picker.body);
  return section;
}
