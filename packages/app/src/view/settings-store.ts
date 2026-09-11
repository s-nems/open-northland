import { DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME } from '@open-northland/audio';
import { DEFAULT_KEY_BINDINGS, type KeyBindings, parseKeyBindings } from '../hud/keybindings.js';
import { clampUiScaleFactor, DEFAULT_UI_SCALE_FACTOR } from '../hud/ui-scale.js';
import { defaultLocale, isLocale, type Locale } from '../i18n/index.js';

/**
 * The player settings persisted in localStorage. Settings surfaces edit them; a launching game reads
 * session-shaping values directly from here rather than through URL params.
 */

export type AssetSet = 'own' | 'original';

/** Drawn-frame cap in frames per second; `null` follows the display's own refresh rate. */
export type FpsLimit = 30 | 60 | null;

export const RENDER_SCALE_MIN = 0.5;
export const RENDER_SCALE_MAX = 2;
const DEFAULT_RENDER_SCALE = 1;

export interface MenuSettings {
  readonly assets: AssetSet;
  /** Fullscreen preference, written by whatever changes the window; `view/fullscreen.ts` owns how a
   *  document gets back into it. */
  readonly displayMode: 'fullscreen' | 'window';
  /** Backing-resolution multiplier for the game canvas; 1 keeps the plain device oversample. */
  readonly renderScale: number;
  /** Relative factor over the viewport-derived HUD base scale; the menu's own scale is
   *  viewport-derived too. */
  readonly uiScaleFactor: number;
  /** The world post pass: a warm-graded vignette over the world, under the HUD. */
  readonly postFxEnabled: boolean;
  readonly spriteSmoothing: boolean;
  readonly fpsLimit: FpsLimit;
  /** Mirrors the `?sound` param: `false` starts the game's audio driver muted. */
  readonly soundEnabled: boolean;
  /** Game-sounds volume, 0..1 (effects, jingles, voices - the original `fx_volume`). */
  readonly soundVolume: number;
  /** Music volume, 0..1 (the original `dm_volume`). */
  readonly musicVolume: number;
  readonly language: Locale;
  /** A launching game resolves its hotkeys from here, like the HUD scale factor. */
  readonly keyBindings: KeyBindings;
}

/** A player who never chose a language follows the browser's. */
export function defaultSettings(): MenuSettings {
  return {
    assets: 'own',
    displayMode: 'window',
    renderScale: DEFAULT_RENDER_SCALE,
    uiScaleFactor: DEFAULT_UI_SCALE_FACTOR,
    postFxEnabled: true,
    spriteSmoothing: true,
    fpsLimit: null,
    soundEnabled: true,
    soundVolume: DEFAULT_SFX_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
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

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
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
    assets: record.assets === 'original' ? 'original' : defaults.assets,
    displayMode: record.displayMode === 'fullscreen' ? 'fullscreen' : 'window',
    renderScale: clampRenderScale(record.renderScale),
    uiScaleFactor: clampFactor(record.uiScaleFactor),
    postFxEnabled: typeof record.postFxEnabled === 'boolean' ? record.postFxEnabled : defaults.postFxEnabled,
    spriteSmoothing:
      typeof record.spriteSmoothing === 'boolean' ? record.spriteSmoothing : defaults.spriteSmoothing,
    fpsLimit: parseFpsLimit(record.fpsLimit),
    soundEnabled: typeof record.soundEnabled === 'boolean' ? record.soundEnabled : defaults.soundEnabled,
    soundVolume: clampVolume(record.soundVolume, defaults.soundVolume),
    musicVolume: clampVolume(record.musicVolume, defaults.musicVolume),
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

/** Merge one live surface's changes without overwriting settings it does not own. */
export function patchStoredSettings(patch: Partial<MenuSettings>): MenuSettings {
  const next = { ...readStoredSettings(), ...patch };
  persistSettings(next);
  return next;
}
