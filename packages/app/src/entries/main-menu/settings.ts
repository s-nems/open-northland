import { uiScaleFor } from '../../hud/ui-scale.js';
import { messages } from '../../i18n/index.js';
import { createSettingsPage, type SettingsMemory, type SettingsPageStore } from '../../view/settings-page.js';
import type { MenuScreen } from './model.js';
import { screenHead } from './screen-head.js';
import { menuSettings, updateSettings } from './settings-state.js';

export type { SettingsMemory } from '../../view/settings-page.js';

export interface SettingsScreenHandle {
  readonly el: HTMLElement;
  dispose(): void;
}

export function settingsScreen(
  open: (screen: MenuScreen) => void,
  memory: SettingsMemory,
  signal: AbortSignal,
  onLanguageChange: () => void,
): SettingsScreenHandle {
  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__settings';
  const settings: SettingsPageStore = {
    current: menuSettings,
    update: async (patch) => {
      updateSettings(patch);
      return true;
    },
    pinnedUiScale: null,
    effectiveUiScaleFor: (factor) => uiScaleFor(window.innerHeight, factor),
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
  return { el: section, dispose: page.dispose };
}
