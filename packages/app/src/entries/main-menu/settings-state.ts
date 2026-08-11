import { defaultLocale, localeParam, setActiveLocale } from '../../i18n/index.js';
import { type MenuSettings, persistSettings, readStoredSettings } from '../../view/settings-store.js';

/**
 * The menu's settings session: the persisted store plus URL overrides. `lang` and `sound` are
 * projected onto the carried URL params so a launched game receives them; the HUD scale factor and
 * the graphics settings are read from the store directly and never enter the URL.
 */

export type SettingsTab = 'graphics' | 'audio' | 'gameplay' | 'controls';

export interface SettingsTabItem {
  readonly id: SettingsTab;
  /** `comingSoon` renders a badge and takes no input. */
  readonly kind: 'open' | 'comingSoon';
}

export const SETTINGS_TABS: readonly SettingsTabItem[] = [
  { id: 'graphics', kind: 'open' },
  { id: 'audio', kind: 'open' },
  { id: 'gameplay', kind: 'open' },
  { id: 'controls', kind: 'open' },
];

/** Active settings tab; outlives the screen so a language re-render returns to the same tab. */
export interface SettingsMemory {
  tab: SettingsTab;
}

export function initialSettingsMemory(): SettingsMemory {
  return { tab: 'graphics' };
}

/** Quarter steps: 50%, 75%, … 200%; finer render-scale grades are indistinguishable in play. */
export const RENDER_SCALE_STEP = 0.25;

export interface CarriedSettingParam {
  readonly key: keyof MenuSettings;
  readonly param: string;
  /** `null` means the value is the default and the param is elided from the URL. */
  readonly value: string | null;
}

/** The single home of the carried-param names, default elision, and value formatting. */
export function carriedSettingParams(settings: MenuSettings): readonly CarriedSettingParam[] {
  return [
    {
      key: 'language',
      param: 'lang',
      // The elided default is the browser's language, so a `lang`-less link follows whoever opens it.
      value: settings.language === defaultLocale() ? null : settings.language,
    },
    { key: 'soundEnabled', param: 'sound', value: settings.soundEnabled ? null : 'off' },
  ];
}

/** What localStorage holds: only the user's own choices, never URL-adopted overrides. */
let persisted: MenuSettings | null = null;
/** The session's effective settings: `persisted` plus any explicit URL overrides. */
let current: MenuSettings | null = null;
/** Live consumers of the settings the menu writes, such as the menu's own music. */
const listeners = new Set<(settings: MenuSettings) => void>();

/** Follow every {@link updateSettings} until `signal` aborts. */
export function onSettingsChange(listener: (settings: MenuSettings) => void, signal: AbortSignal): void {
  if (signal.aborted) return;
  listeners.add(listener);
  signal.addEventListener('abort', () => listeners.delete(listener));
}

function persistedSettings(): MenuSettings {
  persisted ??= readStoredSettings();
  return persisted;
}

export function menuSettings(): MenuSettings {
  current ??= persistedSettings();
  return current;
}

/**
 * The store advances by the patch alone, so a shared link's URL overrides never leak into the stored
 * defaults.
 */
export function updateSettings(patch: Partial<MenuSettings>): MenuSettings {
  const next = { ...menuSettings(), ...patch };
  current = next;
  persisted = { ...persistedSettings(), ...patch };
  persistSettings(persisted);
  if (patch.language !== undefined) setActiveLocale(next.language);
  syncCarriedParams(patch, next);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * The pure half of the menu-boot bridge: a carried param absent from `params` adopts the stored
 * value (mutating `params` and reported in `adopted`), while an explicit one wins for the session.
 */
export function adoptSettings(
  stored: MenuSettings,
  params: URLSearchParams,
): { session: MenuSettings; adopted: readonly { param: string; value: string }[] } {
  const adopted: { param: string; value: string }[] = [];
  for (const { param, value } of carriedSettingParams(stored)) {
    if (params.has(param) || value === null) continue;
    params.set(param, value);
    adopted.push({ param, value });
  }
  return {
    session: {
      ...stored,
      language: localeParam(params),
      soundEnabled: params.get('sound') !== 'off',
    },
    adopted,
  };
}

/**
 * Menu-boot bridge between the store and the URL: layers the stored settings under the explicit URL
 * params, without persisting URL overrides. Only the menu runs this; direct `?map=` and `?scene=`
 * entries take the carried params from the URL as-is and read store-only settings straight from the
 * store. Mutates `params` in place.
 */
export function adoptStoredSettings(params: URLSearchParams): void {
  const { session, adopted } = adoptSettings(persistedSettings(), params);
  const url = new URL(window.location.href);
  for (const { param, value } of adopted) url.searchParams.set(param, value);
  window.history.replaceState(window.history.state, '', url);
  current = session;
  setActiveLocale(session.language);
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
