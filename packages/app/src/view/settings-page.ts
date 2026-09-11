import { type Locale, messages } from '../i18n/index.js';
import { enterFullscreen, isFullscreen, leaveFullscreen } from './fullscreen.js';
import { segControl, settingRow, sliderControl, togglePill } from './settings-controls.js';
import { createControlsTab } from './settings-controls-tab.js';
import { createSettingsDisplayMode, type DisplayMode } from './settings-display-mode.js';
import { graphicsSettingsRows } from './settings-graphics-tab.js';
import { defaultSettings, type MenuSettings } from './settings-store.js';

export type SettingsTab = 'graphics' | 'audio' | 'gameplay' | 'controls';

export interface SettingsMemory {
  tab: SettingsTab;
}

export interface SettingsPageStore {
  current(): MenuSettings;
  update(patch: Partial<MenuSettings>): Promise<boolean>;
  readonly pinnedUiScale: number | null;
  effectiveUiScaleFor(factor: number): number;
  /** True when boot-owned graphics, language, and bindings are being edited from a running game. */
  readonly bootOwnedChangesDeferred?: boolean;
}

export interface SettingsPageHandle {
  readonly el: HTMLElement;
  render(): void;
  dispose(): void;
}

const SETTINGS_TABS: readonly SettingsTab[] = ['graphics', 'audio', 'gameplay', 'controls'];
const LANGUAGE_CHOICES: readonly Locale[] = ['pol', 'eng'];
const PLACEHOLDER_SCROLL_SPEED = 1;
const PLACEHOLDER_STEP = 0.05;
const VOLUME_MIN = 0;
const VOLUME_MAX = 1;
const VOLUME_STEP = 0.01;
const SCROLL_SPEED_MIN = 0.5;
const SCROLL_SPEED_MAX = 2;

export function initialSettingsMemory(): SettingsMemory {
  return { tab: 'graphics' };
}

export function createSettingsPage(opts: {
  readonly settings: SettingsPageStore;
  readonly memory: SettingsMemory;
  readonly signal: AbortSignal;
  readonly onLanguageChange?: () => void;
  /** False while the host keeps the page mounted but hidden; viewport changes then skip re-rendering. */
  readonly visible?: () => boolean;
}): SettingsPageHandle {
  const root = document.createElement('div');
  root.className = 'main-menu__settings-page';
  const scope = new AbortController();
  if (opts.signal.aborted) scope.abort();
  else
    opts.signal.addEventListener('abort', () => scope.abort(), {
      once: true,
      signal: scope.signal,
    });

  let renderPanel = (): void => undefined;
  let controls: ReturnType<typeof createControlsTab> | null = null;
  let renderVersion = 0;
  let uiScaleCommit = 0;

  const focusKeyOf = (element: Element | null): string | null =>
    element instanceof HTMLElement ? (element.dataset.settingsFocus ?? null) : null;
  const restoreFocus = (key: string | null): void => {
    if (key === null) return;
    const target = [...root.querySelectorAll<HTMLElement>('[data-settings-focus]')].find(
      (element) => element.dataset.settingsFocus === key,
    );
    target?.focus();
  };
  const markSegment = (root: HTMLElement, prefix: string): void => {
    for (const [index, button] of [...root.querySelectorAll<HTMLButtonElement>('button')].entries()) {
      button.dataset.settingsFocus = `${prefix}:${index}`;
    }
  };
  const liveDisplayMode = (): DisplayMode => (isFullscreen() ? 'fullscreen' : 'window');
  const displayMode = createSettingsDisplayMode({
    current: liveDisplayMode,
    enter: enterFullscreen,
    leave: leaveFullscreen,
    commit: (mode) => opts.settings.update({ displayMode: mode }),
    onSettled: () => {
      if (root.isConnected && opts.memory.tab === 'graphics') render();
    },
  });
  const render = (): void => {
    const focusedKey = focusKeyOf(document.activeElement);
    controls?.disarm();
    renderVersion++;
    const copy = messages().mainMenu;
    const text = copy.settings;
    const soon = { badge: copy.comingSoon, tip: copy.comingSoonTip };

    const nav = document.createElement('nav');
    nav.className = 'main-menu__settings-nav';
    const panel = document.createElement('div');
    panel.className = 'main-menu__settings-panel';
    const status = document.createElement('p');
    status.className = 'main-menu__settings-status';
    status.setAttribute('role', 'status');

    const tabButtons = new Map<SettingsTab, HTMLButtonElement>();
    const paintTabs = (): void => {
      for (const [id, button] of tabButtons) {
        button.classList.toggle('is-active', id === opts.memory.tab);
        button.setAttribute('aria-pressed', String(id === opts.memory.tab));
      }
    };
    for (const tab of SETTINGS_TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'main-menu__settings-tab';
      button.dataset.settingsFocus = `tab:${tab}`;
      button.textContent = text.tabs[tab];
      button.addEventListener('click', () => {
        opts.memory.tab = tab;
        paintTabs();
        renderPanel();
      });
      tabButtons.set(tab, button);
      nav.append(button);
    }

    const applyUiScale = async (value: number): Promise<void> => {
      const commit = ++uiScaleCommit;
      const startedRenderVersion = renderVersion;
      status.textContent = '';
      const applied = await opts.settings.update({ uiScaleFactor: value });
      if (commit !== uiScaleCommit) return;
      if (applied) {
        if (renderVersion !== startedRenderVersion) render();
        return;
      }
      render();
      const liveStatus = root.querySelector<HTMLElement>('.main-menu__settings-status');
      if (liveStatus !== null) liveStatus.textContent = messages().mainMenu.settings.uiScaleApplyFailed;
    };

    const graphicsRows = (): HTMLElement[] =>
      graphicsSettingsRows(
        opts.settings,
        liveDisplayMode,
        (mode) => displayMode.request(mode),
        applyUiScale,
        markSegment,
      );

    const audioRows = (): HTMLElement[] => {
      const settings = opts.settings.current();
      const sound = togglePill(settings.soundEnabled, (enabled) => {
        void opts.settings.update({ soundEnabled: enabled });
      });
      sound.setAttribute('aria-label', text.soundEnabled);
      sound.dataset.settingsFocus = 'sound-enabled';
      const volume = (
        label: string,
        value: number,
        patch: (value: number) => Partial<MenuSettings>,
        focusKey: string,
      ): HTMLDivElement => {
        const control = sliderControl(label, {
          min: VOLUME_MIN,
          max: VOLUME_MAX,
          step: VOLUME_STEP,
          value,
          onCommit: (next) => {
            void opts.settings.update(patch(next));
          },
          live: true,
        });
        const input = control.querySelector<HTMLInputElement>('input');
        if (input !== null) input.dataset.settingsFocus = focusKey;
        return control;
      };
      return [
        settingRow(text.soundEnabled, sound),
        settingRow(
          text.sfxVolume,
          volume(text.sfxVolume, settings.soundVolume, (soundVolume) => ({ soundVolume }), 'sfx-volume'),
        ),
        settingRow(
          text.musicVolume,
          volume(text.musicVolume, settings.musicVolume, (musicVolume) => ({ musicVolume }), 'music-volume'),
        ),
      ];
    };

    const gameplayRows = (): HTMLElement[] => {
      const settings = opts.settings.current();
      const language = segControl(
        LANGUAGE_CHOICES.map((locale) => ({ id: locale, label: text.languageNames[locale] })),
        settings.language,
        (locale) => {
          if (locale === opts.settings.current().language) return;
          void opts.settings.update({ language: locale }).then((applied) => {
            if (!applied) return;
            opts.onLanguageChange?.();
            if (root.isConnected) render();
          });
        },
      );
      markSegment(language.root, 'language');
      const scrollSpeed = sliderControl(text.scrollSpeed, {
        min: SCROLL_SPEED_MIN,
        max: SCROLL_SPEED_MAX,
        step: PLACEHOLDER_STEP,
        value: PLACEHOLDER_SCROLL_SPEED,
      });
      const edgeScroll = togglePill(true, () => undefined);
      return [
        settingRow(
          text.language,
          language.root,
          opts.settings.bootOwnedChangesDeferred === true ? { tip: text.nextGameTip } : undefined,
        ),
        settingRow(text.scrollSpeed, scrollSpeed, { soon }),
        settingRow(text.edgeScroll, edgeScroll, { soon }),
      ];
    };

    controls = createControlsTab({
      current: opts.settings.current,
      update: opts.settings.update,
      settingRow,
      repaintPanel: (focusKey) => {
        renderPanel();
        restoreFocus(focusKey ?? null);
      },
      ...(opts.settings.bootOwnedChangesDeferred === true ? { deferredTip: text.nextGameTip } : {}),
    });
    const rowsFor: Record<SettingsTab, () => HTMLElement[]> = {
      graphics: graphicsRows,
      audio: audioRows,
      gameplay: gameplayRows,
      controls: controls.rows,
    };
    renderPanel = (): void => {
      controls?.disarm();
      panel.replaceChildren(...rowsFor[opts.memory.tab]());
    };
    paintTabs();
    renderPanel();

    const body = document.createElement('div');
    body.className = 'main-menu__settings-body';
    body.append(nav, panel);

    const foot = document.createElement('div');
    foot.className = 'main-menu__settings-foot';
    const autosave = document.createElement('span');
    autosave.className = 'main-menu__settings-autosave';
    autosave.textContent = text.autosaveNote;
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'main-menu__ghost';
    restore.dataset.settingsFocus = 'restore';
    restore.textContent = text.restoreDefaults;
    restore.addEventListener('click', () => {
      const displayReset = displayMode.reserve('window');
      const { displayMode: _displayMode, ...defaults } = defaultSettings();
      void opts.settings.update(defaults).then((applied) => {
        if (!applied) {
          displayReset.cancel();
          render();
          const liveStatus = root.querySelector<HTMLElement>('.main-menu__settings-status');
          if (liveStatus !== null) liveStatus.textContent = messages().mainMenu.settings.restoreFailed;
          return;
        }
        displayReset.apply();
        opts.onLanguageChange?.();
        if (root.isConnected) render();
      });
    });
    foot.append(status, autosave, restore);
    root.replaceChildren(body, foot);
    restoreFocus(focusedKey);
  };

  const onViewportChange = (): void => {
    if (!root.isConnected || opts.visible?.() === false) return;
    if (opts.memory.tab === 'graphics') render();
  };
  document.addEventListener('fullscreenchange', onViewportChange, { signal: scope.signal });
  window.addEventListener('resize', onViewportChange, { signal: scope.signal });
  scope.signal.addEventListener('abort', () => controls?.disarm());

  render();
  return { el: root, render, dispose: () => scope.abort() };
}
