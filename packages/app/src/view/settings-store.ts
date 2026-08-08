import { DEFAULT_KEY_BINDINGS, type KeyBindings, parseKeyBindings } from '../hud/keybindings.js';
import { clampUiScaleFactor, DEFAULT_UI_SCALE_FACTOR } from '../hud/ui-scale.js';
import { defaultLocale, isLocale, type Locale } from '../i18n/index.js';

/**
 * The player settings persisted in localStorage. The menu edits them; a launching game reads the
 * session-shaping ones (the HUD scale factor) directly from here rather than through URL params.
 */

/** Drawn-frame cap in frames per second; `null` follows the display's own refresh rate. */
export type FpsLimit = 30 | 60 | null;

export const RENDER_SCALE_MIN = 0.5;
export const RENDER_SCALE_MAX = 2;
export const DEFAULT_RENDER_SCALE = 1;

export interface MenuSettings {
  /** Fullscreen preference. Browsers grant fullscreen only on a user gesture, so the screen shows
   *  the live state; the stored value is for shells that can apply it at boot (desktop). */
  readonly displayMode: 'fullscreen' | 'window';
  /** Multiplier over the DPR-derived backing resolution: below 1 renders fewer texels per CSS px
   *  (the browser upscales), above 1 supersamples. 1 keeps the plain integer oversample. */
  readonly renderScale: number;
  /** Relative factor over the viewport-derived HUD base scale; the menu's own scale is
   *  viewport-derived too. */
  readonly uiScaleFactor: number;
  /** The world post pass (warm-graded vignette); `?postfx` overrides it for one session. */
  readonly postFxEnabled: boolean;
  readonly fpsLimit: FpsLimit;
  /** Mirrors the `?sound` param: `false` starts the game without an audio driver. */
  readonly soundEnabled: boolean;
  readonly language: Locale;
  /** A launching game resolves its hotkeys from here, like the HUD scale factor. */
  readonly keyBindings: KeyBindings;
}

/** A player who never chose a language follows the browser's. */
export function defaultSettings(): MenuSettings {
  return {
    displayMode: 'window',
    renderScale: DEFAULT_RENDER_SCALE,
    uiScaleFactor: DEFAULT_UI_SCALE_FACTOR,
    postFxEnabled: true,
    fpsLimit: null,
    soundEnabled: true,
    language: defaultLocale(),
    keyBindings: DEFAULT_KEY_BINDINGS,
  };
}

const STORAGE_KEY = 'open-northland.settings';

function clampFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_UI_SCALE_FACTOR;
  return clampUiScaleFactor(value);
}

function clampRenderScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RENDER_SCALE;
  return Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, value));
}

function parseFpsLimit(value: unknown): FpsLimit {
  return value === 30 || value === 60 ? value : null;
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
    renderScale: clampRenderScale(record.renderScale),
    // Blobs from before the relative-factor model carried an absolute `uiScale`; it is ignored.
    uiScaleFactor: clampFactor(record.uiScaleFactor),
    postFxEnabled: typeof record.postFxEnabled === 'boolean' ? record.postFxEnabled : defaults.postFxEnabled,
    fpsLimit: parseFpsLimit(record.fpsLimit),
    soundEnabled: typeof record.soundEnabled === 'boolean' ? record.soundEnabled : defaults.soundEnabled,
    language: isLocale(record.language) ? record.language : defaults.language,
    keyBindings: parseKeyBindings(record.keyBindings),
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
