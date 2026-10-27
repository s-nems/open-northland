import type { SoundDriver } from '@open-northland/audio';
import type { WorldEnhancements } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import type { MinimapHandle } from '../../hud/minimap/index.js';
import { displayViewOf, uiScaleFor } from '../../hud/ui-scale.js';
import { defaultLocale, localeParam } from '../../i18n/index.js';
import type { CameraController } from '../camera/index.js';
import { replaceEntryUrl } from '../platform/navigation-guard.js';
import { type MenuSettings, patchStoredSettings } from '../settings/store.js';
import type { UnitControls } from '../unit-controls/index.js';
import { createGameHudScaleCoordinator, type HudScaleTarget } from './game-hud-scale.js';
import { createGameSettingsRuntime, type GameSettingsRuntime, gameSoundEnabled } from './game-settings.js';
import { createGameViewportCoordinator } from './game-viewport.js';

export interface LiveGameSettingsDeps {
  readonly screen: { readonly width: number; readonly height: number };
  readonly initialViewport: { readonly width: number; readonly height: number };
  readonly params: URLSearchParams;
  readonly stored: MenuSettings;
  readonly pinnedUiScale: number | null;
  readonly camera: CameraController;
  readonly minimap: MinimapHandle;
  readonly controls: UnitControls;
  /** The DOM HUD plane, scaled with the Pixi parts. */
  readonly hudDom: HudScaleTarget;
  readonly sound: SoundDriver | null;
  readonly setDebugToolsEnabled: (enabled: boolean) => void;
  readonly setSelectionStyle: (style: MenuSettings['selectionStyle']) => void;
  readonly setHoverOutline: (enabled: boolean) => void;
  readonly setGroupNumbersShown: (shown: boolean) => void;
  readonly setGraphicsEnhancements: (settings: WorldEnhancements) => void;
  readonly setKeyBindings: (bindings: MenuSettings['keyBindings']) => void;
  readonly setWeatherEnabled: (enabled: boolean) => void;
  readonly setBloodEnabled: (enabled: boolean) => void;
  readonly setBonesFade: (fades: boolean) => void;
  readonly setFpsCounterShown: (shown: boolean) => void;
  readonly setFpsLimit: (limit: MenuSettings['fpsLimit']) => void;
}

export interface LiveGameSettings {
  readonly settings: GameSettingsRuntime;
  syncViewport(nowMs: number): void;
  dispose(): void;
}

/** Connect persisted live settings to the mounted HUD, audio driver, and Pixi viewport. */
export function createLiveGameSettings(deps: LiveGameSettingsDeps): LiveGameSettings {
  const initialUiScale =
    deps.pinnedUiScale ??
    uiScaleFor(
      displayViewOf(deps.initialViewport.width, deps.initialViewport.height),
      deps.stored.uiScaleFactor,
    );
  const hudScale = createGameHudScaleCoordinator({
    initialScale: initialUiScale,
    targets: [deps.minimap, deps.controls, deps.hudDom],
    onError: (error) => diag.warn('ui', `HUD scale rebuild failed: ${String(error)}`),
  });
  const viewport = createGameViewportCoordinator({
    initialWidth: deps.initialViewport.width,
    initialHeight: deps.initialViewport.height,
    initialDisplayHeight: window.screen.height,
    initialUiScaleFactor: deps.stored.uiScaleFactor,
    pinnedUiScale: deps.pinnedUiScale,
    camera: deps.camera.camera,
    setCamera: deps.camera.jumpTo,
    currentUiScale: hudScale.currentScale,
    requestUiScale: hudScale.request,
  });
  const initialSoundEnabled = gameSoundEnabled(deps.params, deps.stored.soundEnabled);
  const sound = deps.sound;
  const syncCarriedParam = (param: string, value: string | null): void => {
    if (value === null) deps.params.delete(param);
    else deps.params.set(param, value);
    const url = new URL(window.location.href);
    url.search = deps.params.toString();
    replaceEntryUrl(url);
  };
  const settings = createGameSettingsRuntime({
    initial: {
      ...deps.stored,
      soundEnabled: initialSoundEnabled,
      language: localeParam(deps.params),
    },
    pinnedUiScale: deps.pinnedUiScale,
    effectiveUiScaleFor: (factor) =>
      deps.pinnedUiScale ?? uiScaleFor(displayViewOf(deps.screen.width, deps.screen.height), factor),
    persist: (patch) => {
      patchStoredSettings(patch);
    },
    setUiScaleFactor: viewport.setUiScaleFactor,
    setSoundEnabled: (enabled) => {
      syncCarriedParam('sound', enabled ? null : 'off');
      deps.sound?.setEnabled(enabled);
    },
    setVolumes: (volumes) => deps.sound?.setVolumes(volumes),
    setSoundInBackground: (play) => deps.sound?.setPlayInBackground(play),
    setMonoSound: (mono) => deps.sound?.setMono(mono),
    setJinglesEnabled: (on) => deps.sound?.setJinglesEnabled(on),
    setUnitResponses: (mode) => deps.sound?.setUnitResponses(mode),
    setLanguage: (language) => {
      syncCarriedParam('lang', language === defaultLocale() ? null : language);
    },
    setKeyBindings: deps.setKeyBindings,
    setCameraInputSettings: deps.camera.setInputSettings,
    setDebugToolsEnabled: deps.setDebugToolsEnabled,
    setSelectionStyle: deps.setSelectionStyle,
    setHoverOutline: deps.setHoverOutline,
    setGroupNumbersShown: deps.setGroupNumbersShown,
    setGraphicsEnhancements: deps.setGraphicsEnhancements,
    setMinimapFrame: deps.minimap.setFrame,
    setWeatherEnabled: deps.setWeatherEnabled,
    setBloodEnabled: deps.setBloodEnabled,
    setBonesFade: deps.setBonesFade,
    setFpsCounterShown: deps.setFpsCounterShown,
    setFpsLimit: deps.setFpsLimit,
    ...(sound !== null ? { previewBus: (bus) => sound.previewBus(bus) } : {}),
  });

  return {
    settings,
    syncViewport: (nowMs) =>
      viewport.sync(deps.screen.width, deps.screen.height, window.screen.height, nowMs),
    dispose: hudScale.dispose,
  };
}
