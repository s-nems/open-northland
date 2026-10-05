import { DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME } from '@open-northland/audio';
import { DEFAULT_PIXEL_ART_SCALER, type PixelArtScaler, parsePixelArtScaler } from '@open-northland/render';
import {
  changedKeyBindings,
  DEFAULT_KEY_BINDINGS,
  type KeyBindings,
  parseKeyBindings,
} from '../hud/keybindings.js';
import { DEFAULT_MINIMAP_FILTERS, type MinimapFilters, parseMinimapFilters } from '../hud/minimap/filters.js';
import { DEFAULT_MINIMAP_FRAME, type MinimapFrame, parseMinimapFrame } from '../hud/minimap/frames.js';
import { clampUiScaleFactor, DEFAULT_UI_SCALE_FACTOR } from '../hud/ui-scale.js';
import { defaultLocale, isLocale, type Locale } from '../i18n/index.js';
import {
  type CursorSize,
  type CursorTheme,
  DEFAULT_CURSOR_SIZE,
  DEFAULT_CURSOR_THEME,
  parseCursorSize,
  parseCursorTheme,
} from './cursors/model.js';

/**
 * The player settings persisted in localStorage. Settings surfaces edit them; a launching game reads
 * session-shaping values directly from here rather than through URL params.
 */

/** Drawn-frame cap in frames per second; `null` follows the display's own refresh rate. */
export type FpsLimit = 30 | 60 | null;

export const RENDER_SCALE_MIN = 0.5;
export const RENDER_SCALE_MAX = 2;
const DEFAULT_RENDER_SCALE = 1;

export const SCROLL_SPEED_MIN = 0.5;
export const SCROLL_SPEED_MAX = 3;
export const DEFAULT_SCROLL_SPEED = 1.5;

export interface MenuSettings {
  /** Fullscreen preference, written by whatever changes the window; `view/fullscreen.ts` owns how a
   *  document gets back into it. */
  readonly displayMode: 'fullscreen' | 'window';
  /** Backing-resolution multiplier for the game canvas; 1 keeps the plain device oversample. */
  readonly renderScale: number;
  /** Relative factor over the display-derived HUD base scale (`uiScaleFor`); the menu's own
   *  scale follows the viewport. */
  readonly uiScaleFactor: number;
  /** The world post pass: a warm-graded vignette over the world, under the HUD. */
  readonly postFxEnabled: boolean;
  readonly spriteSmoothing: boolean;
  readonly enhancedSampling: boolean;
  readonly pixelArtScaler: PixelArtScaler;
  readonly softShadows: boolean;
  readonly enhancedWater: boolean;
  readonly environmentMotion: boolean;
  readonly groundedBuildings: boolean;
  /** Rain, snow and sandstorms: their sky, ground and sound. Presentation only, the sim never reads it. */
  readonly weather: boolean;
  readonly fpsLimit: FpsLimit;
  readonly cursorTheme: CursorTheme;
  readonly cursorSize: CursorSize;
  readonly minimapFrame: MinimapFrame;
  /** The minimap's marker layers and owner scope, set from its filters popover. */
  readonly minimapFilters: MinimapFilters;
  /** Mirrors the `?sound` param: `false` starts the game's audio driver muted. */
  readonly soundEnabled: boolean;
  /** Game-sounds volume, 0..1 (effects, jingles, voices - the original `fx_volume`). */
  readonly soundVolume: number;
  /** Music volume, 0..1 (the original `dm_volume`). */
  readonly musicVolume: number;
  readonly language: Locale;
  readonly keyboardScrollSpeed: number;
  readonly edgeScrollSpeed: number;
  readonly dragScrollSpeed: number;
  readonly edgeScrollEnabled: boolean;
  /** Reverse only middle-button drag; directional edge and keyboard input keep their meaning. */
  readonly invertDragScroll: boolean;
  /** A launching game resolves its hotkeys from here, like the HUD scale factor. */
  readonly keyBindings: KeyBindings;
  /** The display name shown to other players over a relay; null until one was chosen. */
  readonly netNick: string | null;
  readonly debugToolsEnabled: boolean;
}

/** A player who never chose a language follows the browser's. */
export function defaultSettings(): MenuSettings {
  return {
    displayMode: 'window',
    renderScale: DEFAULT_RENDER_SCALE,
    uiScaleFactor: DEFAULT_UI_SCALE_FACTOR,
    postFxEnabled: true,
    spriteSmoothing: true,
    enhancedSampling: true,
    pixelArtScaler: DEFAULT_PIXEL_ART_SCALER,
    softShadows: true,
    enhancedWater: true,
    environmentMotion: true,
    groundedBuildings: true,
    weather: true,
    fpsLimit: null,
    cursorTheme: DEFAULT_CURSOR_THEME,
    cursorSize: DEFAULT_CURSOR_SIZE,
    minimapFrame: DEFAULT_MINIMAP_FRAME,
    minimapFilters: DEFAULT_MINIMAP_FILTERS,
    soundEnabled: true,
    soundVolume: DEFAULT_SFX_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
    language: defaultLocale(),
    keyboardScrollSpeed: DEFAULT_SCROLL_SPEED,
    edgeScrollSpeed: DEFAULT_SCROLL_SPEED,
    dragScrollSpeed: DEFAULT_SCROLL_SPEED,
    edgeScrollEnabled: true,
    invertDragScroll: true,
    keyBindings: DEFAULT_KEY_BINDINGS,
    netNick: null,
    debugToolsEnabled: false,
  };
}

const STORAGE_KEY = 'open-northland.settings';
const volatileSettings = new WeakMap<object, MenuSettings>();

function clampFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_UI_SCALE_FACTOR;
  return clampUiScaleFactor(value);
}

function clampRenderScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RENDER_SCALE;
  return Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, value));
}

function clampScrollSpeed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SCROLL_SPEED;
  return Math.min(SCROLL_SPEED_MAX, Math.max(SCROLL_SPEED_MIN, value));
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
    displayMode: record.displayMode === 'fullscreen' ? 'fullscreen' : 'window',
    renderScale: clampRenderScale(record.renderScale),
    uiScaleFactor: clampFactor(record.uiScaleFactor),
    postFxEnabled: typeof record.postFxEnabled === 'boolean' ? record.postFxEnabled : defaults.postFxEnabled,
    spriteSmoothing:
      typeof record.spriteSmoothing === 'boolean' ? record.spriteSmoothing : defaults.spriteSmoothing,
    enhancedSampling:
      typeof record.enhancedSampling === 'boolean' ? record.enhancedSampling : defaults.enhancedSampling,
    pixelArtScaler: parsePixelArtScaler(record.pixelArtScaler) ?? defaults.pixelArtScaler,
    softShadows: typeof record.softShadows === 'boolean' ? record.softShadows : defaults.softShadows,
    enhancedWater: typeof record.enhancedWater === 'boolean' ? record.enhancedWater : defaults.enhancedWater,
    environmentMotion:
      typeof record.environmentMotion === 'boolean' ? record.environmentMotion : defaults.environmentMotion,
    groundedBuildings:
      typeof record.groundedBuildings === 'boolean' ? record.groundedBuildings : defaults.groundedBuildings,
    weather: typeof record.weather === 'boolean' ? record.weather : defaults.weather,
    fpsLimit: parseFpsLimit(record.fpsLimit),
    cursorTheme: parseCursorTheme(record.cursorTheme),
    cursorSize: parseCursorSize(record.cursorSize),
    minimapFrame: parseMinimapFrame(record.minimapFrame),
    minimapFilters: parseMinimapFilters(record.minimapFilters),
    soundEnabled: typeof record.soundEnabled === 'boolean' ? record.soundEnabled : defaults.soundEnabled,
    soundVolume: clampVolume(record.soundVolume, defaults.soundVolume),
    musicVolume: clampVolume(record.musicVolume, defaults.musicVolume),
    language: isLocale(record.language) ? record.language : defaults.language,
    keyboardScrollSpeed: clampScrollSpeed(record.keyboardScrollSpeed),
    edgeScrollSpeed: clampScrollSpeed(record.edgeScrollSpeed),
    dragScrollSpeed: clampScrollSpeed(record.dragScrollSpeed),
    edgeScrollEnabled:
      typeof record.edgeScrollEnabled === 'boolean' ? record.edgeScrollEnabled : defaults.edgeScrollEnabled,
    invertDragScroll:
      typeof record.invertDragScroll === 'boolean' ? record.invertDragScroll : defaults.invertDragScroll,
    keyBindings: parseKeyBindings(record.changedKeyBindings),
    netNick: optionalText(record.netNick),
    debugToolsEnabled:
      typeof record.debugToolsEnabled === 'boolean' ? record.debugToolsEnabled : defaults.debugToolsEnabled,
  };
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The persisted settings, or defaults when storage is empty or denied (private mode). */
export function readStoredSettings(): MenuSettings {
  try {
    const pending = volatileSettings.get(window);
    if (pending !== undefined) return pending;
    return parseStoredSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultSettings();
  }
}

type StoredSettings = Omit<MenuSettings, 'language' | 'keyBindings'> & {
  readonly language?: MenuSettings['language'];
  readonly changedKeyBindings: ReturnType<typeof changedKeyBindings>;
};

/**
 * A language matching the browser's is left out of the blob, the same elision the URL makes, and so
 * is every binding still at its default: changing an unrelated setting never freezes a language or a
 * key the player never picked, and a new default reaches them.
 */
function storedShape(settings: MenuSettings): StoredSettings {
  const { language, keyBindings, ...rest } = settings;
  return {
    ...rest,
    ...(language === defaultLocale() ? {} : { language }),
    changedKeyBindings: changedKeyBindings(keyBindings),
  };
}

const storedListeners = new Set<(settings: MenuSettings) => void>();

/** Document-wide preferences also apply when private mode denies persistence. */
export function onStoredSettingsChange(listener: (settings: MenuSettings) => void): () => void {
  storedListeners.add(listener);
  return () => {
    storedListeners.delete(listener);
  };
}

/** Persist the settings and notify document-wide consumers. */
export function persistSettings(settings: MenuSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedShape(settings)));
    volatileSettings.delete(window);
  } catch {
    // Retain sequential patches and menu/game handovers when storage is unavailable or full.
    if (typeof window !== 'undefined') volatileSettings.set(window, settings);
  }
  for (const listener of storedListeners) listener(settings);
}

/** Merge one live surface's changes without overwriting settings it does not own. */
export function patchStoredSettings(patch: Partial<MenuSettings>): MenuSettings {
  const next = { ...readStoredSettings(), ...patch };
  persistSettings(next);
  return next;
}
