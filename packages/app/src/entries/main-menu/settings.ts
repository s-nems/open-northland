import { DEFAULT_MASTER_GAIN } from '@open-northland/audio';
import { UI_SCALE_FACTOR_MAX, UI_SCALE_FACTOR_MIN, uiScaleFor } from '../../hud/ui-scale.js';
import { currentLocale, type Locale, messages } from '../../i18n/index.js';
import { DEFAULT_SETTINGS, type MenuSettings } from '../../view/settings-store.js';
import { type SegHandle, segControl, togglePill } from './controls.js';
import type { MenuScreen } from './model.js';
import { screenHead } from './screen-head.js';
import {
  menuSettings,
  SETTINGS_TABS,
  type SettingsMemory,
  type SettingsTab,
  UI_SCALE_FACTOR_STEP,
  updateSettings,
} from './settings-state.js';

type DisplayMode = MenuSettings['displayMode'];

/** In-menu language choices, in display order. */
const LANGUAGE_CHOICES: readonly Locale[] = ['pol', 'eng'];

/** Resting position of the disabled scroll-speed slider: the camera tuning's current 1x. */
const PLACEHOLDER_SCROLL_SPEED = 1;
const PLACEHOLDER_STEP = 0.05;
const VOLUME_MIN = 0;
const VOLUME_MAX = 1;
const SCROLL_SPEED_MIN = 0.5;
const SCROLL_SPEED_MAX = 2;

interface SliderSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** A multiplier; the value label renders it as a percentage. */
  readonly value: number;
  readonly onCommit?: (value: number) => void;
  /** Replaces the default percent value label. */
  readonly format?: (value: number) => string;
}

function sliderControl(label: string, spec: SliderSpec): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'main-menu__settings-slider';
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'main-menu__settings-range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.value);
  input.setAttribute('aria-label', label);
  const value = document.createElement('span');
  value.className = 'main-menu__settings-value';
  const paint = (): void => {
    const v = Number(input.value);
    value.textContent = spec.format?.(v) ?? `${Math.round(v * 100)}%`;
    // The track's filled fraction; the CSS gradient reads it as a percentage.
    input.style.setProperty('--fill', String(((v - spec.min) / (spec.max - spec.min)) * 100));
  };
  paint();
  input.addEventListener('input', paint);
  const commit = spec.onCommit;
  if (commit !== undefined) input.addEventListener('change', () => commit(Number(input.value)));
  wrap.append(input, value);
  return wrap;
}

function settingRow(
  label: string,
  control: HTMLElement,
  soon?: { badge: string; tip: string },
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'main-menu__settings-row';
  const name = document.createElement('span');
  name.className = 'main-menu__settings-label';
  name.textContent = label;
  row.append(name, control);
  if (soon !== undefined) {
    row.classList.add('is-coming-soon');
    row.title = soon.tip;
    const badge = document.createElement('span');
    badge.className = 'main-menu__badge';
    badge.textContent = soon.badge;
    name.append(badge);
    for (const el of [control, ...control.querySelectorAll('button, input')]) {
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.disabled = true;
    }
  }
  return row;
}

/** Every live control applies and persists immediately; controls without an engine seam sit
 *  disabled behind "coming soon" badges. */
export function settingsScreen(open: (screen: MenuScreen) => void, memory: SettingsMemory): HTMLElement {
  const copy = messages().mainMenu;
  const text = copy.settings;
  const soon = { badge: copy.comingSoon, tip: copy.comingSoonTip };

  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__settings';
  const head = screenHead('settings', open);

  const nav = document.createElement('nav');
  nav.className = 'main-menu__settings-nav';
  const panel = document.createElement('div');
  panel.className = 'main-menu__settings-panel';
  const tabButtons = new Map<SettingsTab, HTMLButtonElement>();
  const paintTabs = (): void => {
    for (const [id, button] of tabButtons) {
      button.classList.toggle('is-active', id === memory.tab);
      button.setAttribute('aria-pressed', String(id === memory.tab));
    }
  };
  for (const tab of SETTINGS_TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__settings-tab';
    button.append(text.tabs[tab.id]);
    if (tab.kind === 'comingSoon') {
      // aria-disabled instead of `disabled`: hover must survive for the tooltip.
      button.classList.add('is-coming-soon');
      button.setAttribute('aria-disabled', 'true');
      button.title = copy.comingSoonTip;
      const badge = document.createElement('span');
      badge.className = 'main-menu__badge';
      badge.textContent = copy.comingSoon;
      button.append(badge);
    } else {
      button.addEventListener('click', () => {
        memory.tab = tab.id;
        paintTabs();
        renderPanel();
      });
    }
    tabButtons.set(tab.id, button);
    nav.append(button);
  }

  // Fullscreen also leaves via Esc, and a resize can arrive from the OS, both outside any control of
  // ours; either changes the height behind the display segment, the resolution chip and the
  // effective-scale readout, so both viewport events rebuild the panel.
  let displaySeg: SegHandle<DisplayMode> | null = null;
  const liveDisplayMode = (): DisplayMode => (document.fullscreenElement !== null ? 'fullscreen' : 'window');
  const onViewportChange = (): void => {
    if (!section.isConnected) {
      unhookViewport();
      return;
    }
    renderPanel();
  };
  const unhookViewport = (): void => {
    document.removeEventListener('fullscreenchange', onViewportChange);
    window.removeEventListener('resize', onViewportChange);
  };
  document.addEventListener('fullscreenchange', onViewportChange);
  window.addEventListener('resize', onViewportChange);
  head.querySelector('.main-menu__back')?.addEventListener('click', unhookViewport);

  const graphicsRows = (): HTMLElement[] => {
    const settings = menuSettings();
    displaySeg = segControl<DisplayMode>(
      [
        { id: 'fullscreen', label: text.displayFullscreen },
        { id: 'window', label: text.displayWindow },
      ],
      liveDisplayMode(),
      (mode) => {
        updateSettings({ displayMode: mode });
        // The repaint waits for fullscreenchange; a denied request must not leave the segment
        // showing a fullscreen that never happened.
        if (mode === 'fullscreen') {
          document.documentElement.requestFullscreen().catch(() => displaySeg?.setActive(liveDisplayMode()));
        } else if (document.fullscreenElement !== null) {
          void document.exitFullscreen();
        }
      },
    );
    // Placeholder for the resolution control: the canvas follows the window, so show the live size.
    const resolutionChip = document.createElement('span');
    resolutionChip.className = 'main-menu__settings-chip';
    resolutionChip.textContent = `${window.innerWidth} × ${window.innerHeight}`;
    // 100% is the viewport-derived base; the label also shows the effective in-game multiplier, which
    // exposes the `MIN_UI_SCALE` floor - on very short windows the lowest factor steps collapse to it.
    const uiScale = sliderControl(text.uiScale, {
      min: UI_SCALE_FACTOR_MIN,
      max: UI_SCALE_FACTOR_MAX,
      step: UI_SCALE_FACTOR_STEP,
      value: settings.uiScaleFactor,
      onCommit: (value) => updateSettings({ uiScaleFactor: value }),
      format: (value) => `${Math.round(value * 100)}% (×${uiScaleFor(window.innerHeight, value).toFixed(2)})`,
    });
    return [
      settingRow(text.displayMode, displaySeg.root),
      settingRow(text.resolution, resolutionChip, soon),
      settingRow(text.uiScale, uiScale),
    ];
  };

  const audioRows = (): HTMLElement[] => {
    const sound = togglePill(menuSettings().soundEnabled, (on) => updateSettings({ soundEnabled: on }));
    sound.setAttribute('aria-label', text.soundEnabled);
    const volume = (label: string): HTMLDivElement =>
      sliderControl(label, {
        min: VOLUME_MIN,
        max: VOLUME_MAX,
        step: PLACEHOLDER_STEP,
        value: DEFAULT_MASTER_GAIN,
      });
    return [
      settingRow(text.soundEnabled, sound),
      settingRow(text.masterVolume, volume(text.masterVolume), soon),
      settingRow(text.musicVolume, volume(text.musicVolume), soon),
      settingRow(text.sfxVolume, volume(text.sfxVolume), soon),
    ];
  };

  const gameplayRows = (): HTMLElement[] => {
    const language = segControl(
      LANGUAGE_CHOICES.map((locale) => ({ id: locale, label: text.languageNames[locale] })),
      currentLocale(),
      (locale) => {
        if (locale === currentLocale()) return;
        updateSettings({ language: locale }); // activates the locale too
        open('settings'); // rebuild the screen in the new language
      },
    );
    const scrollSpeed = sliderControl(text.scrollSpeed, {
      min: SCROLL_SPEED_MIN,
      max: SCROLL_SPEED_MAX,
      step: PLACEHOLDER_STEP,
      value: PLACEHOLDER_SCROLL_SPEED,
    });
    const edgeScroll = togglePill(true, () => undefined);
    return [
      settingRow(text.language, language.root),
      settingRow(text.scrollSpeed, scrollSpeed, soon),
      settingRow(text.edgeScroll, edgeScroll, soon),
    ];
  };

  const rowsFor: Record<SettingsTab, () => HTMLElement[]> = {
    graphics: graphicsRows,
    audio: audioRows,
    gameplay: gameplayRows,
    controls: () => [], // the tab is comingSoon and cannot become active
  };
  const renderPanel = (): void => {
    panel.replaceChildren(...rowsFor[memory.tab]());
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
  restore.textContent = text.restoreDefaults;
  restore.addEventListener('click', () => {
    updateSettings(DEFAULT_SETTINGS);
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    open('settings');
  });
  foot.append(autosave, restore);

  section.append(head, body, foot);
  return section;
}
