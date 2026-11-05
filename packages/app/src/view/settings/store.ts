import {
  clampVolume,
  DEFAULT_MUSIC_SOURCE,
  DEFAULT_UNIT_RESPONSES,
  DEFAULT_VOLUMES,
  isNarrationRate,
  type MixerVolumes,
  type MusicSource,
  type NarrationRate,
  parseMusicSource,
  parseUnitResponses,
  type UnitResponses,
} from '@open-northland/audio';
import { SOUND_QUALITIES, type SoundQuality } from '@open-northland/data';
import {
  type BackingDensity,
  type BackingDensitySetting,
  DEFAULT_PIXEL_ART_SCALER,
  DEFAULT_SELECTION_STYLE,
  type PixelArtScaler,
  parseBackingDensitySetting,
  parsePixelArtScaler,
  parseSelectionStyle,
  resolveBackingDensity,
  type SelectionStyle,
} from '@open-northland/render';
import {
  changedKeyBindings,
  DEFAULT_KEY_BINDINGS,
  type KeyBindings,
  parseKeyBindings,
} from '../../hud/keybindings.js';
import {
  DEFAULT_MINIMAP_FILTERS,
  type MinimapFilters,
  parseMinimapFilters,
} from '../../hud/minimap/filters.js';
import { DEFAULT_MINIMAP_FRAME, type MinimapFrame, parseMinimapFrame } from '../../hud/minimap/frames.js';
import { clampUiScaleFactor, DEFAULT_UI_SCALE_FACTOR } from '../../hud/ui-scale.js';
import { defaultLocale, isLocale, type Locale } from '../../i18n/index.js';
import {
  type CursorSize,
  type CursorTheme,
  DEFAULT_CURSOR_SIZE,
  DEFAULT_CURSOR_THEME,
  parseCursorSize,
  parseCursorTheme,
} from '../cursors/model.js';

/**
 * The player settings persisted in localStorage. Settings surfaces edit them; a launching game reads
 * session-shaping values directly from here rather than through URL params.
 */

/** Zero disables autosaving; other values count minutes of simulation time. */
export type AutosaveMinutes = 0 | 5 | 10 | 15 | 30;

/** How many autosaves of one map rotate before the oldest is overwritten. */
export const AUTOSAVE_COUNTS = [1, 2, 3] as const;
export type AutosaveCount = (typeof AUTOSAVE_COUNTS)[number];
const DEFAULT_AUTOSAVE_COUNT: AutosaveCount = 1;

/** Drawn-frame cap in frames per second; `null` follows the display's own refresh rate. */
export type FpsLimit = 30 | 60 | null;
/** 60 by default: a 144 Hz laptop panel would otherwise draw 2.4 times the frames of a 60 Hz one for
 *  no visible gain in an isometric game, on the web and the desktop alike. */
const DEFAULT_FPS_LIMIT: FpsLimit = 60;

export const RENDER_SCALE_MIN = 0.5;
export const RENDER_SCALE_MAX = 2;
const DEFAULT_RENDER_SCALE = 1;

/** Player colour boldness for colour-vision-deficient players; 1 = retail palette, 10 = boldest. Local only. */
export const TEAM_COLOR_STRENGTH_MIN = 1;
export const TEAM_COLOR_STRENGTH_MAX = 10;

/** A whole-viewport colour-blindness correction filter; `off` leaves the image uncorrected. Local only. */
export type ColorBlindFilter = 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'generic';
export const COLOR_BLIND_FILTERS: readonly ColorBlindFilter[] = [
  'off',
  'deuteranopia',
  'protanopia',
  'tritanopia',
  'generic',
] as const;

export const SCROLL_SPEED_MIN = 0.5;
export const SCROLL_SPEED_MAX = 3;
export const DEFAULT_SCROLL_SPEED = 1.5;

export interface MenuSettings {
  /** Fullscreen preference, written by whatever changes the window; `view/platform/fullscreen.ts` owns how a
   *  document gets back into it. */
  readonly displayMode: 'fullscreen' | 'window';
  /** Backing-resolution multiplier for the game canvas; 1 keeps the plain device oversample. */
  readonly renderScale: number;
  /** How a display denser than its CSS pixels draws the game (`BackingDensitySetting`): every device
   *  pixel, fewer texels upscaled, or `auto` (upscaled from 1.5 device pixels per CSS pixel); applies
   *  from the next game. */
  readonly backingDensity: BackingDensitySetting;
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
  readonly buildingDamage: boolean;
  /** Rain, snow and sandstorms: their sky, ground and sound, and the tints a script moves with them.
   *  Presentation only, the sim never reads it. */
  readonly weather: boolean;
  /** Off holds a scripted or game cycle at daylight and draws any remaining night flat, without its
   *  lights. Presentation only, the sim never reads it. */
  readonly dayNight: boolean;
  /** Hit sprays and ground stains; local presentation only. */
  readonly blood: boolean;
  /** Bone piles fade out with age; off keeps them for good. Local presentation only. */
  readonly bonesFade: boolean;
  readonly fpsLimit: FpsLimit;
  /** The frame rate on the top bar; hovering it breaks down what holds the game back. */
  readonly fpsCounter: boolean;
  readonly cursorTheme: CursorTheme;
  readonly cursorSize: CursorSize;
  readonly selectionStyle: SelectionStyle;
  /** The outline a hovered unit or building draws, as the original shows one; off draws none. */
  readonly hoverOutline: boolean;
  /** The label beside the cursor naming what a click would do and the thing it rests on. */
  readonly cursorHints: boolean;
  /** A small label of its control groups' numbers by each unit bound to one. */
  readonly groupNumbers: boolean;
  /** Player colour boldness for colour-vision-deficient players; 1 = retail palette, 10 = boldest. Local only. */
  readonly teamColorStrength: number;
  /** A whole-viewport colour-blindness correction filter; `off` leaves the image uncorrected. Local only. */
  readonly colorBlindFilter: ColorBlindFilter;
  readonly minimapFrame: MinimapFrame;
  /** The minimap's marker layers and owner scope, set from its filters popover. */
  readonly minimapFilters: MinimapFilters;
  /** Mirrors the `?sound` param: `false` starts the game's audio driver muted. */
  readonly soundEnabled: boolean;
  /** Mixer slider positions, 0..100 per channel. */
  readonly volumes: MixerVolumes;
  /** Sound keeps playing while the tab is hidden or the window unfocused; off fades it out there. */
  readonly soundInBackground: boolean;
  /** The whole mix folded to one channel, for a player who hears on one ear. */
  readonly monoSound: boolean;
  /** The jingles for something done (a building, a birth, a discovery); alerts ring regardless. */
  readonly jinglesEnabled: boolean;
  /** Which of an order and a selection a settler's voice answers. */
  readonly unitResponses: UnitResponses;
  /** Whether a game plays the map's own music or the local nation's. */
  readonly musicSource: MusicSource;
  /** The tempo a briefing's narrator reads at, set from the briefing's player. */
  readonly narrationRate: NarrationRate;
  /** Which sound banks a starting game loads: FLAC or the smaller Opus encoding. */
  readonly soundQuality: SoundQuality;
  readonly language: Locale;
  readonly keyboardScrollSpeed: number;
  readonly edgeScrollSpeed: number;
  readonly dragScrollSpeed: number;
  readonly edgeScrollEnabled: boolean;
  /** Reverse only middle-button drag; directional edge and keyboard input keep their meaning. */
  readonly invertDragScroll: boolean;
  /** Zoom only where art pixels map to whole device pixels; off by default, since the fixed steps are
   *  coarse and the zoom no longer glides. */
  readonly integerScaling: boolean;
  /** A launching game resolves its hotkeys from here, like the HUD scale factor. */
  readonly keyBindings: KeyBindings;
  /** The display name shown to other players over a relay; null until one was chosen. */
  readonly netNick: string | null;
  /** The flag shown beside the nick over a relay: a flag code, or `none` for a choice of none; null
   *  until one was chosen. */
  readonly netFlag: string | null;
  /** A relay address the player typed in; null while they play on one of the official regions. */
  readonly netCustomRelayUrl: string | null;
  readonly debugToolsEnabled: boolean;
  /** A crash or freeze sends its light bug report at once; off, the problem dialog asks first. */
  readonly autoErrorReports: boolean;
  /** A folder the player picked passed the original-game check; on the desktop the shell's record decides. */
  readonly originalGameVerified: boolean;
  /** The recognized release, such as `Cultures: Northland (PL)`; null when its library size is unlisted. */
  readonly originalGameLabel: string | null;
  /** The name of the folder the player picked in a browser, which never learns its path. */
  readonly originalGameFolder: string | null;
  readonly autosaveMinutes: AutosaveMinutes;
  readonly autosaveCount: AutosaveCount;
}

/** The desktop game, known by its shell's bridge, owns its window and keeps sounding behind another
 *  one; a browser tab goes quiet among the player's other tabs. */
export function defaultSoundInBackground(): boolean {
  return typeof window !== 'undefined' && window.desktop !== undefined;
}

/** The desktop reads its sounds from disk, so it takes the lossless banks; a browser downloads them,
 *  so it takes the compact ones. */
export function defaultSoundQuality(): SoundQuality {
  return typeof window !== 'undefined' && window.desktop !== undefined ? 'lossless' : 'compact';
}

/** A player who never chose a language follows the browser's. */
export function defaultSettings(): MenuSettings {
  return {
    displayMode: 'window',
    renderScale: DEFAULT_RENDER_SCALE,
    backingDensity: 'auto',
    uiScaleFactor: DEFAULT_UI_SCALE_FACTOR,
    postFxEnabled: true,
    spriteSmoothing: true,
    enhancedSampling: true,
    pixelArtScaler: DEFAULT_PIXEL_ART_SCALER,
    softShadows: true,
    enhancedWater: true,
    environmentMotion: true,
    groundedBuildings: true,
    buildingDamage: true,
    weather: true,
    dayNight: true,
    blood: true,
    bonesFade: true,
    fpsLimit: DEFAULT_FPS_LIMIT,
    fpsCounter: import.meta.env?.DEV === true,
    cursorTheme: DEFAULT_CURSOR_THEME,
    cursorSize: DEFAULT_CURSOR_SIZE,
    selectionStyle: DEFAULT_SELECTION_STYLE,
    hoverOutline: true,
    cursorHints: true,
    groupNumbers: false,
    teamColorStrength: TEAM_COLOR_STRENGTH_MIN,
    colorBlindFilter: 'off',
    minimapFrame: DEFAULT_MINIMAP_FRAME,
    minimapFilters: DEFAULT_MINIMAP_FILTERS,
    soundEnabled: true,
    volumes: DEFAULT_VOLUMES,
    soundInBackground: defaultSoundInBackground(),
    monoSound: false,
    jinglesEnabled: true,
    unitResponses: DEFAULT_UNIT_RESPONSES,
    musicSource: DEFAULT_MUSIC_SOURCE,
    narrationRate: 1,
    soundQuality: defaultSoundQuality(),
    language: defaultLocale(),
    keyboardScrollSpeed: DEFAULT_SCROLL_SPEED,
    edgeScrollSpeed: DEFAULT_SCROLL_SPEED,
    dragScrollSpeed: DEFAULT_SCROLL_SPEED,
    edgeScrollEnabled: true,
    invertDragScroll: true,
    integerScaling: false,
    keyBindings: DEFAULT_KEY_BINDINGS,
    netNick: null,
    netFlag: null,
    netCustomRelayUrl: null,
    debugToolsEnabled: import.meta.env?.DEV === true,
    autoErrorReports: true,
    originalGameVerified: false,
    originalGameLabel: null,
    originalGameFolder: null,
    autosaveMinutes: 0,
    autosaveCount: DEFAULT_AUTOSAVE_COUNT,
  };
}

const STORAGE_KEY = 'open-northland.settings';
const volatileSettings = new WeakMap<object, MenuSettings>();
const initializations = new WeakMap<Window, Promise<void>>();

function settingsPresence(): 'present' | 'absent' | 'denied' {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === null ? 'absent' : 'present';
  } catch {
    return 'denied';
  }
}

/** Seed a fresh installation once, before any entry reads settings. Any existing blob belongs to the
 * player. A denied read is not evidence of absence, so it must never cause a persistent write. */
export function initializeStoredSettings(
  defaults: () => MenuSettings | Promise<MenuSettings>,
): Promise<void> {
  const pending = initializations.get(window);
  if (pending !== undefined) return pending;
  const owner = window;
  const initialize = async (): Promise<void> => {
    const before = settingsPresence();
    if (volatileSettings.has(owner) || before === 'present') return;
    const settings = await defaults();
    // A user edit or another tab may have written preferences while the database was loading.
    const after = settingsPresence();
    if (volatileSettings.has(owner) || after === 'present') return;
    if (before === 'denied' || after === 'denied') volatileSettings.set(owner, settings);
    else persistSettings(settings);
  };
  const result = initialize().finally(() => initializations.delete(owner));
  initializations.set(owner, result);
  return result;
}

function clampFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_UI_SCALE_FACTOR;
  return clampUiScaleFactor(value);
}

/** The game canvas's backing store from the stored settings at the window's device-pixel ratio, for
 *  `createWindowPixiApp`. */
export function windowBacking(
  settings: MenuSettings,
  devicePixelRatio: number,
): {
  readonly resolutionScale: number;
  readonly density: BackingDensity;
} {
  return {
    resolutionScale: settings.renderScale,
    density: resolveBackingDensity(
      settings.backingDensity,
      devicePixelRatio,
      settings.renderScale,
      settings.enhancedSampling,
    ),
  };
}

function clampRenderScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RENDER_SCALE;
  return Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, value));
}

function clampTeamColorStrength(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TEAM_COLOR_STRENGTH_MIN;
  return Math.min(TEAM_COLOR_STRENGTH_MAX, Math.max(TEAM_COLOR_STRENGTH_MIN, Math.round(value)));
}

function clampScrollSpeed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SCROLL_SPEED;
  return Math.min(SCROLL_SPEED_MAX, Math.max(SCROLL_SPEED_MIN, value));
}

function parseFpsLimit(value: unknown): FpsLimit {
  return value === 30 || value === 60 || value === null ? value : DEFAULT_FPS_LIMIT;
}

/** Each slider rounded into its range; a channel missing or deformed in the blob takes its default. */
function parseVolumes(value: unknown): MixerVolumes {
  if (typeof value !== 'object' || value === null) return DEFAULT_VOLUMES;
  const record = value as Record<string, unknown>;
  const position = (channel: keyof MixerVolumes): number => {
    const stored = record[channel];
    if (typeof stored !== 'number' || !Number.isFinite(stored)) return DEFAULT_VOLUMES[channel];
    return Math.round(clampVolume(stored));
  };
  return {
    master: position('master'),
    music: position('music'),
    responses: position('responses'),
    world: position('world'),
    ambient: position('ambient'),
    ui: position('ui'),
  };
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
    autosaveMinutes:
      record.autosaveMinutes === 5 ||
      record.autosaveMinutes === 10 ||
      record.autosaveMinutes === 15 ||
      record.autosaveMinutes === 30
        ? record.autosaveMinutes
        : 0,
    autosaveCount: AUTOSAVE_COUNTS.find((count) => count === record.autosaveCount) ?? DEFAULT_AUTOSAVE_COUNT,
    displayMode: record.displayMode === 'fullscreen' ? 'fullscreen' : 'window',
    renderScale: clampRenderScale(record.renderScale),
    backingDensity: parseBackingDensitySetting(record.backingDensity) ?? 'auto',
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
    buildingDamage:
      typeof record.buildingDamage === 'boolean' ? record.buildingDamage : defaults.buildingDamage,
    weather: typeof record.weather === 'boolean' ? record.weather : defaults.weather,
    dayNight: typeof record.dayNight === 'boolean' ? record.dayNight : defaults.dayNight,
    blood: typeof record.blood === 'boolean' ? record.blood : defaults.blood,
    bonesFade: typeof record.bonesFade === 'boolean' ? record.bonesFade : defaults.bonesFade,
    fpsLimit: parseFpsLimit(record.fpsLimit),
    fpsCounter: typeof record.fpsCounter === 'boolean' ? record.fpsCounter : defaults.fpsCounter,
    cursorTheme: parseCursorTheme(record.cursorTheme),
    cursorSize: parseCursorSize(record.cursorSize),
    selectionStyle: parseSelectionStyle(record.selectionStyle),
    hoverOutline: typeof record.hoverOutline === 'boolean' ? record.hoverOutline : defaults.hoverOutline,
    cursorHints: typeof record.cursorHints === 'boolean' ? record.cursorHints : defaults.cursorHints,
    groupNumbers: typeof record.groupNumbers === 'boolean' ? record.groupNumbers : defaults.groupNumbers,
    teamColorStrength: clampTeamColorStrength(record.teamColorStrength),
    colorBlindFilter:
      COLOR_BLIND_FILTERS.find((filter) => filter === record.colorBlindFilter) ?? defaults.colorBlindFilter,
    minimapFrame: parseMinimapFrame(record.minimapFrame),
    minimapFilters: parseMinimapFilters(record.minimapFilters),
    soundEnabled: typeof record.soundEnabled === 'boolean' ? record.soundEnabled : defaults.soundEnabled,
    volumes: parseVolumes(record.volumes),
    soundInBackground:
      typeof record.soundInBackground === 'boolean' ? record.soundInBackground : defaults.soundInBackground,
    monoSound: typeof record.monoSound === 'boolean' ? record.monoSound : defaults.monoSound,
    jinglesEnabled:
      typeof record.jinglesEnabled === 'boolean' ? record.jinglesEnabled : defaults.jinglesEnabled,
    unitResponses: parseUnitResponses(record.unitResponses),
    musicSource: parseMusicSource(record.musicSource),
    narrationRate: isNarrationRate(record.narrationRate) ? record.narrationRate : defaults.narrationRate,
    soundQuality: SOUND_QUALITIES.find((quality) => quality === record.soundQuality) ?? defaults.soundQuality,
    language: isLocale(record.language) ? record.language : defaults.language,
    keyboardScrollSpeed: clampScrollSpeed(record.keyboardScrollSpeed),
    edgeScrollSpeed: clampScrollSpeed(record.edgeScrollSpeed),
    dragScrollSpeed: clampScrollSpeed(record.dragScrollSpeed),
    edgeScrollEnabled:
      typeof record.edgeScrollEnabled === 'boolean' ? record.edgeScrollEnabled : defaults.edgeScrollEnabled,
    invertDragScroll:
      typeof record.invertDragScroll === 'boolean' ? record.invertDragScroll : defaults.invertDragScroll,
    integerScaling:
      typeof record.integerScaling === 'boolean' ? record.integerScaling : defaults.integerScaling,
    keyBindings: parseKeyBindings(record.changedKeyBindings),
    netNick: optionalText(record.netNick),
    netFlag: optionalText(record.netFlag),
    netCustomRelayUrl: optionalText(record.netCustomRelayUrl),
    debugToolsEnabled:
      typeof record.debugToolsEnabled === 'boolean' ? record.debugToolsEnabled : defaults.debugToolsEnabled,
    autoErrorReports:
      typeof record.autoErrorReports === 'boolean' ? record.autoErrorReports : defaults.autoErrorReports,
    originalGameVerified: record.originalGameVerified === true,
    originalGameLabel: optionalText(record.originalGameLabel),
    originalGameFolder: optionalText(record.originalGameFolder),
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
