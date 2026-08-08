import { clampUiScaleFactor, DEFAULT_UI_SCALE_FACTOR } from '../hud/ui-scale.js';
import { defaultLocale, isLocale, type Locale } from '../i18n/index.js';

/**
 * The player settings persisted in localStorage. The menu edits them; a launching game reads the
 * session-shaping ones (the HUD scale factor) directly from here rather than through URL params.
 */

export interface MenuSettings {
  /** Fullscreen preference. Browsers grant fullscreen only on a user gesture, so the screen shows
   *  the live state; the stored value is for shells that can apply it at boot (desktop). */
  readonly displayMode: 'fullscreen' | 'window';
  /** Relative factor over the viewport-derived HUD base scale; the menu's own scale is
   *  viewport-derived too. */
  readonly uiScaleFactor: number;
  /** Mirrors the `?sound` param: `false` starts the game without an audio driver. */
  readonly soundEnabled: boolean;
  readonly language: Locale;
}

/** A player who never chose a language follows the browser's. */
export function defaultSettings(): MenuSettings {
  return {
    displayMode: 'window',
    uiScaleFactor: DEFAULT_UI_SCALE_FACTOR,
    soundEnabled: true,
    language: defaultLocale(),
  };
}

const STORAGE_KEY = 'open-northland.settings';

function clampFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_UI_SCALE_FACTOR;
  return clampUiScaleFactor(value);
}

/** Parse a stored settings blob; a missing or deformed field falls back to its default. */
export function parseStoredSettings(raw: string | null): MenuSettings {
  const defaults = defaultSettings();
  if (raw === null) return defaults;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof data !== 'object' || data === null) return defaults;
  const record = data as Record<string, unknown>;
  return {
    displayMode: record.displayMode === 'fullscreen' ? 'fullscreen' : 'window',
    // Blobs from before the relative-factor model carried an absolute `uiScale`; it is ignored.
    uiScaleFactor: clampFactor(record.uiScaleFactor),
    soundEnabled: typeof record.soundEnabled === 'boolean' ? record.soundEnabled : defaults.soundEnabled,
    language: isLocale(record.language) ? record.language : defaults.language,
  };
}

/** The persisted settings, or defaults when storage is empty or denied (private mode). */
export function readStoredSettings(): MenuSettings {
  try {
    return parseStoredSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultSettings();
  }
}

/**
 * A language matching the browser's is left out of the blob, the same elision the URL makes, so
 * changing an unrelated setting never freezes a language the player never picked.
 */
function storedShape(settings: MenuSettings): Partial<MenuSettings> {
  const { language, ...rest } = settings;
  return language === defaultLocale() ? rest : settings;
}

/** Persist the settings to localStorage. */
export function persistSettings(settings: MenuSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedShape(settings)));
  } catch {
    // Storage denied (private mode): the caller's in-memory state still applies.
  }
}
