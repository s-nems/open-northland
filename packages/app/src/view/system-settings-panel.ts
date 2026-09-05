import { messages } from '../i18n/index.js';
import type { GameSettingsRuntime } from './runtime/game-settings.js';
import type { SavePanelView } from './save-panels/index.js';
import { createSettingsPage, initialSettingsMemory } from './settings-page.js';

export interface SystemSettingsPanelDeps {
  readonly settings: GameSettingsRuntime;
  readonly showMenu: () => void;
  readonly panelStyle: string;
  readonly signal: AbortSignal;
  readonly onLanguageChange: () => void;
}

/** The same settings page the main menu hosts, backed by the active game's live settings adapter. */
export function buildSystemSettingsPanel(deps: SystemSettingsPanelDeps): SavePanelView {
  const panel = document.createElement('section');
  panel.className = 'system-menu__settings';
  panel.style.cssText = deps.panelStyle;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const head = document.createElement('div');
  head.className = 'main-menu__screen-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'main-menu__back';
  back.addEventListener('click', deps.showMenu);
  const title = document.createElement('h2');
  title.className = 'main-menu__screen-title';
  head.append(back, title);

  const relabel = (): void => {
    const copy = messages().mainMenu;
    title.textContent = copy.screenTitles.settings;
    panel.setAttribute('aria-label', title.textContent);
    back.textContent = `← ${copy.backLabels.main}`;
  };
  const page = createSettingsPage({
    settings: deps.settings,
    memory: initialSettingsMemory(),
    signal: deps.signal,
    onLanguageChange: () => {
      relabel();
      deps.onLanguageChange();
    },
    // The panel stays mounted (hidden) for the whole game; without this every window resize during
    // play would rebuild the invisible page DOM.
    visible: () => panel.style.display !== 'none',
  });
  panel.append(head, page.el);

  return {
    el: panel,
    open: () => {
      relabel();
      page.render();
    },
  };
}
