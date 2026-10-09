import { displayViewOf, uiScaleFor } from '../../hud/ui-scale.js';
import { messages } from '../../i18n/index.js';
import { createSettingsPage, type SettingsMemory, type SettingsPageStore } from '../../view/settings-page.js';
import type { MenuScreen, MountedScreen } from './model.js';
import type { MenuSound } from './music.js';
import { screenHead } from './screen-head.js';
import { menuSettings, updateSettings } from './settings-state.js';

export type { SettingsMemory } from '../../view/settings-page.js';

export function settingsScreen(
  open: (screen: MenuScreen) => void,
  memory: SettingsMemory,
  signal: AbortSignal,
  onLanguageChange: () => void,
  sound: MenuSound,
): MountedScreen {
  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__settings';
  const settings: SettingsPageStore = {
    current: menuSettings,
    update: async (patch) => {
      await updateSettings(patch);
      return true;
    },
    pinnedUiScale: null,
    effectiveUiScaleFor: (factor) => uiScaleFor(displayViewOf(window.innerWidth, window.innerHeight), factor),
    previewBus: sound.previewBus,
  };
  const head = screenHead('settings', open);
  const relabel = (): void => {
    const copy = messages().mainMenu;
    const back = head.querySelector<HTMLButtonElement>('.main-menu__back');
    const title = head.querySelector<HTMLElement>('.main-menu__screen-title');
    if (back !== null) back.textContent = `← ${copy.backLabels.main}`;
    if (title !== null) title.textContent = copy.screenTitles.settings;
    onLanguageChange();
  };
  const page = createSettingsPage({
    settings,
    memory,
    signal,
    onLanguageChange: relabel,
  });
  section.append(head, page.el);
  return { element: section, dispose: page.dispose };
}
