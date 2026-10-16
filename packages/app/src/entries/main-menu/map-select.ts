import type { MusicSilencer } from '../../campaign/movie.js';
import { localAlliedVision } from '../../game/session-rules.js';
import { drawSessionSeed } from '../../game/session-url.js';
import { messages } from '../../i18n/index.js';
import type { LaunchEntry } from '../../launch.js';
import { targetSearch } from '../../view/target-search.js';
import { campaignTabBody } from './campaign/screen.js';
import { initialLobbyOptions, initialLobbyState, lobbyStartEntry } from './lobby/model.js';
import { mapPicker } from './map-picker.js';
import {
  type MapContentTab,
  type MapSelectItem,
  type MapSelectMemory,
  SINGLE_PLAYER_TABS,
} from './map-select-model.js';
import type { MenuScreen, MountedScreen } from './model.js';
import { screenHead } from './screen-head.js';

/** Free-play maps continue to the lobby; tutorials and test scenes start with their safe defaults.
 *  The Campaign tab swaps its own body in for the map list, under the same head. */
export function mapSelectScreen(
  open: (screen: MenuScreen) => void,
  memory: MapSelectMemory,
  openLobby: (item: MapSelectItem) => void,
  launch: LaunchEntry,
  silenceMusic: MusicSilencer,
): MountedScreen {
  const select = messages().mainMenu.mapSelect;
  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__map-select';
  const head = screenHead('newGame', open);
  const tools = document.createElement('div');
  tools.className = 'main-menu__head-tools';
  const picker = mapPicker({
    memory,
    onContent: (tab) => showContent(tab),
    listing: 'single',
    tabs: SINGLE_PLAYER_TABS,
    primaryLabel: (item) =>
      item.kind === 'scene' ? select.run : item.tutorialStep !== undefined ? select.startLesson : select.next,
    onPrimary: (item) => {
      // targetSearch carries the sticky menu params (lang, sound, ...).
      if (item.kind === 'scene') launch(targetSearch(`?scene=${encodeURIComponent(item.id)}`));
      else if (item.tutorialStep !== undefined) {
        const state = initialLobbyState(item.players);
        const options = initialLobbyOptions(
          new URLSearchParams(window.location.search),
          localAlliedVision(item.types),
        );
        launch(targetSearch(lobbyStartEntry(item.id, state, item.players, options, drawSessionSeed())));
      } else openLobby(item);
    },
  });
  const catalogue = document.createElement('button');
  catalogue.type = 'button';
  catalogue.className = 'main-menu__map-select-catalogue';
  catalogue.textContent = messages().mapCatalogue.open;
  catalogue.addEventListener('click', () => open('catalogue'));
  tools.append(catalogue, picker.tabs);
  head.append(tools);
  section.append(head, picker.body);

  // The list body stays attached while hidden, so its map load still lands for the way back.
  let content: MountedScreen | null = null;
  function showContent(tab: MapContentTab | null): void {
    content?.dispose?.();
    content?.element.remove();
    content = tab === 'campaign' ? campaignTabBody(launch, silenceMusic) : null;
    picker.body.hidden = content !== null;
    if (content !== null) section.append(content.element);
  }
  showContent(memory.content);
  return { element: section, dispose: () => content?.dispose?.() };
}
