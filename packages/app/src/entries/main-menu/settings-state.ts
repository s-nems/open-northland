import { DEFAULT_UI_SCALE } from '../../hud/tool-panel/layout.js';
import { DEFAULT_LOCALE, type Locale, localeParam, setActiveLocale } from '../../i18n/index.js';
import { floatParam } from '../../view/params.js';

/**
 * The menu's persistent settings (design frame 3c): stored in localStorage, projected onto the
 * carried URL params (`lang` / `uiscale` / `sound`) so `targetSearch` hands them to a launched game.
 * The pure parse/clamp half is unit-tested; the storage and URL halves are browser-only.
 */

export type SettingsTab = 'graphics' | 'audio' | 'gameplay' | 'controls';

export interface SettingsTabItem {
  readonly id: SettingsTab;
  /** `comingSoon` renders a badge and takes no input (no keybinding UI exists yet). */
  readonly kind: 'open' | 'comingSoon';
}

export const SETTINGS_TABS: readonly SettingsTabItem[] = [
  { id: 'graphics', kind: 'open' },
  { id: 'audio', kind: 'open' },
  { id: 'gameplay', kind: 'open' },
  { id: 'controls', kind: 'comingSoon' },
];

/** Active settings tab; outlives the screen so a language re-render returns to the same tab. */
export interface SettingsMemory {
  tab: SettingsTab;
}

export function initialSettingsMemory(): SettingsMemory {
  return { tab: 'graphics' };
}

export interface MenuSettings {
  /** Fullscreen preference. Browsers grant fullscreen only on a user gesture, so the screen shows
   *  the live state; the stored value is for shells that can apply it at boot (desktop). */
  readonly displayMode: 'fullscreen' | 'window';
  /** In-game HUD scale multiplier (`?uiscale`); the menu's own scale is viewport-derived. */
  readonly uiScale: number;
  readonly animatedMenuScene: boolean;
  /** Mirrors the `?sound` param: `false` starts the game without an audio driver. */
  readonly soundEnabled: boolean;
  readonly language: Locale;
}

export const DEFAULT_SETTINGS: MenuSettings = {
  displayMode: 'window',
  uiScale: DEFAULT_UI_SCALE,
  animatedMenuScene: true,
  soundEnabled: true,
  language: DEFAULT_LOCALE,
};

export const UI_SCALE_MIN = 1;
export const UI_SCALE_MAX = 2;
/** Slider granularity between {@link UI_SCALE_MIN} and {@link UI_SCALE_MAX} (5% steps). */
export const UI_SCALE_STEP = 0.05;

const STORAGE_KEY = 'open-northland.settings';

function clampScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_UI_SCALE;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
}

/** Parse a stored settings blob; a missing or deformed field falls back to its default. */
export function parseStoredSettings(raw: string | null): MenuSettings {
  if (raw === null) return DEFAULT_SETTINGS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof data !== 'object' || data === null) return DEFAULT_SETTINGS;
  const record = data as Record<string, unknown>;
  return {
    displayMode: record.displayMode === 'fullscreen' ? 'fullscreen' : 'window',
    uiScale: clampScale(record.uiScale),
    animatedMenuScene:
      typeof record.animatedMenuScene === 'boolean'
        ? record.animatedMenuScene
        : DEFAULT_SETTINGS.animatedMenuScene,
    soundEnabled:
      typeof record.soundEnabled === 'boolean' ? record.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    language: record.language === 'eng' ? 'eng' : DEFAULT_LOCALE,
  };
}

/** One row of the settings-to-carried-URL-param projection ({@link carriedSettingParams}). */
export interface CarriedSettingParam {
  readonly key: keyof MenuSettings;
  readonly param: string;
  /** `null` means the value is the default and the param is elided from the URL. */
  readonly value: string | null;
}

/** The single home of the carried-param names, default elision, and value formatting, shared by
 *  the boot bridge ({@link adoptStoredSettings}) and updates ({@link updateSettings}). */
export function carriedSettingParams(settings: MenuSettings): readonly CarriedSettingParam[] {
  return [
    {
      key: 'language',
      param: 'lang',
      value: settings.language === DEFAULT_LOCALE ? null : settings.language,
    },
    {
      key: 'uiScale',
      param: 'uiscale',
      value: settings.uiScale === DEFAULT_UI_SCALE ? null : String(settings.uiScale),
    },
    { key: 'soundEnabled', param: 'sound', value: settings.soundEnabled ? null : 'off' },
  ];
}

type SettingsListener = (settings: MenuSettings) => void;
const listeners = new Set<SettingsListener>();
/** What localStorage holds: only the user's own choices, never URL-adopted overrides. */
let persisted: MenuSettings | null = null;
/** The session's effective settings: `persisted` plus any explicit URL overrides. */
let current: MenuSettings | null = null;

function persistedSettings(): MenuSettings {
  persisted ??= parseStoredSettings(readStorage());
  return persisted;
}

/** The session's effective settings (stored values plus any explicit URL overrides). */
export function menuSettings(): MenuSettings {
  current ??= persistedSettings();
  return current;
}

/**
 * Apply and persist a change: merge into the session settings, advance the store by the patch
 * alone (so a shared link's URL overrides never leak into the stored defaults), activate a patched
 * locale, project the touched carried keys onto the URL, and notify subscribers (the live scene
 * freezes and resumes through this).
 */
export function updateSettings(patch: Partial<MenuSettings>): MenuSettings {
  const next = { ...menuSettings(), ...patch };
  current = next;
  persisted = { ...persistedSettings(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Storage denied (private mode): the change still applies for this session.
  }
  if (patch.language !== undefined) setActiveLocale(next.language);
  syncCarriedParams(patch, next);
  for (const listener of listeners) listener(next);
  return next;
}

/** Subscribers live as long as the menu page; there is no unsubscribe seam yet. */
export function onSettingsChange(listener: SettingsListener): void {
  listeners.add(listener);
}

/**
 * Menu-boot bridge between the store and the URL: carried params absent from the URL adopt the
 * stored non-default values, while explicit ones (a shared `?lang=…` link) win and become the
 * session's effective settings without being persisted. Only the redesigned menu runs this; direct
 * `?map=`/`?scene=` entries and the legacy menu read the URL alone. Mutates `params` in place so
 * the caller's bag matches the rewritten URL.
 */
export function adoptStoredSettings(params: URLSearchParams): void {
  const stored = persistedSettings();
  const url = new URL(window.location.href);
  for (const { param, value } of carriedSettingParams(stored)) {
    if (params.has(param) || value === null) continue;
    url.searchParams.set(param, value);
    params.set(param, value);
  }
  window.history.replaceState(window.history.state, '', url);
  current = {
    ...stored,
    language: localeParam(params),
    uiScale: clampScale(floatParam(params, 'uiscale', stored.uiScale)),
    soundEnabled: params.get('sound') !== 'off',
  };
  setActiveLocale(current.language);
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Project the touched carried keys onto the URL; a value at its default clears the param. */
function syncCarriedParams(patch: Partial<MenuSettings>, next: MenuSettings): void {
  const url = new URL(window.location.href);
  for (const { key, param, value } of carriedSettingParams(next)) {
    if (!(key in patch)) continue;
    if (value === null) url.searchParams.delete(param);
    else url.searchParams.set(param, value);
  }
  window.history.replaceState(window.history.state, '', url);
}
