import type { SoundDriver } from '@open-northland/audio';
import type { WorldEnhancements } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import { panelSpanFromRight } from '../../hud/details-panel/layout/shared.js';
import type { MinimapHandle } from '../../hud/minimap/index.js';
import { minimapPanelWidth } from '../../hud/minimap/model.js';
import { NAV_BEAM_H } from '../../hud/nav-beam.js';
import { TOP_BAR_HEIGHT } from '../../hud/regions.js';
import { uiScaleFor } from '../../hud/ui-scale.js';
import { defaultLocale, localeParam } from '../../i18n/index.js';
import type { CameraController } from '../camera/index.js';
import type { GameToolPanelHandle } from '../game-tool-panel.js';
import type { PerfOverlayHandle } from '../perf-overlay.js';
import { type MenuSettings, patchStoredSettings } from '../settings-store.js';
import type { UnitControls } from '../unit-controls/index.js';
import { createGameHudScaleCoordinator, type HudScaleTarget } from './game-hud-scale.js';
import { createGameSettingsRuntime, type GameSettingsRuntime, gameSoundEnabled } from './game-settings.js';
import { createGameViewportCoordinator } from './game-viewport.js';

const DEBUG_HUD_GAP = 8;

/** The debug readout's span along the bottom edge: from just right of the minimap window to just left of
 *  where the details panel stands, above the navigation beam. */
export function perfCornerForUiScale(scale: number): {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
} {
  return {
    left: minimapPanelWidth(scale) + DEBUG_HUD_GAP,
    right: panelSpanFromRight(scale) + DEBUG_HUD_GAP,
    bottom: NAV_BEAM_H * scale + DEBUG_HUD_GAP,
  };
}

/** The admin chip's top edge: under the top-right bar, clear of the summary counters. */
export function debugPaletteTopForUiScale(scale: number): number {
  return TOP_BAR_HEIGHT * scale + DEBUG_HUD_GAP;
}

export interface LiveGameSettingsDeps {
  readonly screen: { readonly width: number; readonly height: number };
  readonly initialViewport: { readonly width: number; readonly height: number };
  readonly params: URLSearchParams;
  readonly stored: MenuSettings;
  readonly pinnedUiScale: number | null;
  readonly camera: CameraController;
  readonly toolPanel: GameToolPanelHandle;
  readonly minimap: MinimapHandle;
  readonly controls: UnitControls;
  /** The DOM HUD plane, scaled with the Pixi parts. */
  readonly hudDom: HudScaleTarget;
  readonly perf: PerfOverlayHandle;
  readonly placeDebugPalette: (top: number) => void;
  readonly sound: SoundDriver | null;
  readonly setDebugToolsEnabled: (enabled: boolean) => void;
  readonly setGraphicsEnhancements: (settings: WorldEnhancements) => void;
  readonly setKeyBindings: (bindings: MenuSettings['keyBindings']) => void;
}

export interface LiveGameSettings {
  readonly settings: GameSettingsRuntime;
  syncViewport(nowMs: number): void;
  dispose(): void;
}

/** Connect persisted live settings to the mounted HUD, audio driver, and Pixi viewport. */
export function createLiveGameSettings(deps: LiveGameSettingsDeps): LiveGameSettings {
  const initialUiScale =
    deps.pinnedUiScale ?? uiScaleFor(deps.initialViewport.height, deps.stored.uiScaleFactor);
  const hudScale = createGameHudScaleCoordinator({
    initialScale: initialUiScale,
    targets: [deps.toolPanel, deps.minimap, deps.controls, deps.hudDom],
    placeDebugOverlays: (scale) => {
      const corner = perfCornerForUiScale(scale);
      deps.perf.place(corner.left, corner.right, corner.bottom);
      deps.placeDebugPalette(debugPaletteTopForUiScale(scale));
    },
    onError: (error) => diag.warn('ui', `HUD scale rebuild failed: ${String(error)}`),
  });
  const viewport = createGameViewportCoordinator({
    initialWidth: deps.initialViewport.width,
    initialHeight: deps.initialViewport.height,
    initialUiScaleFactor: deps.stored.uiScaleFactor,
    pinnedUiScale: deps.pinnedUiScale,
    camera: deps.camera.camera,
    setCamera: deps.camera.jumpTo,
    currentUiScale: hudScale.currentScale,
    requestUiScale: hudScale.request,
  });
  const initialSoundEnabled = gameSoundEnabled(deps.params, deps.stored.soundEnabled);
  const syncCarriedParam = (param: string, value: string | null): void => {
    if (value === null) deps.params.delete(param);
    else deps.params.set(param, value);
    const url = new URL(window.location.href);
    url.search = deps.params.toString();
    window.history.replaceState(window.history.state, '', url);
  };
  const settings = createGameSettingsRuntime({
    initial: {
      ...deps.stored,
      soundEnabled: initialSoundEnabled,
      language: localeParam(deps.params),
    },
    pinnedUiScale: deps.pinnedUiScale,
    effectiveUiScaleFor: (factor) => deps.pinnedUiScale ?? uiScaleFor(deps.screen.height, factor),
    persist: (patch) => {
      patchStoredSettings(patch);
    },
    setUiScaleFactor: viewport.setUiScaleFactor,
    setSoundEnabled: (enabled) => {
      syncCarriedParam('sound', enabled ? null : 'off');
      deps.sound?.setEnabled(enabled);
    },
    setSfxVolume: (volume) => deps.sound?.setSfxVolume(volume),
    setMusicVolume: (volume) => deps.sound?.setMusicVolume(volume),
    setLanguage: (language) => {
      syncCarriedParam('lang', language === defaultLocale() ? null : language);
    },
    setKeyBindings: deps.setKeyBindings,
    setCameraInputSettings: deps.camera.setInputSettings,
    setDebugToolsEnabled: deps.setDebugToolsEnabled,
    setGraphicsEnhancements: deps.setGraphicsEnhancements,
  });

  return {
    settings,
    syncViewport: (nowMs) => viewport.sync(deps.screen.width, deps.screen.height, nowMs),
    dispose: hudScale.dispose,
  };
}
