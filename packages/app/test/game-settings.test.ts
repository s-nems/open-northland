import { DEFAULT_VOLUMES, type MixerVolumes } from '@open-northland/audio';
import { describe, expect, it, vi } from 'vitest';
import { uiScaleFor } from '../src/hud/ui-scale.js';
import { enhancementsOf } from '../src/view/graphics-enhancements.js';
import { createGameHudScaleCoordinator } from '../src/view/runtime/game-hud-scale.js';
import {
  createGameSettingsRuntime,
  type GameSettingsRuntimeDeps,
  gameSoundEnabled,
} from '../src/view/runtime/game-settings.js';
import { createGameViewportCoordinator } from '../src/view/runtime/game-viewport.js';
import { defaultSettings, parseStoredSettings } from '../src/view/settings-store.js';

/** The default mix with only the world bus moved to `world`. */
const worldAt = (world: number): MixerVolumes => ({ ...DEFAULT_VOLUMES, world });
const QUIET_WORLD = worldAt(35);

it('applies a graphics enhancement immediately without changing its siblings', async () => {
  const h = harness();
  await h.settings.update({ softShadows: false });
  expect(h.settings.current().softShadows).toBe(false);
  expect(h.setGraphicsEnhancements).toHaveBeenCalledWith({
    ...enhancementsOf(defaultSettings()),
    softShadows: false,
  });
});

it('hands the renderer a newly picked pixel-art filter', async () => {
  const h = harness();
  await h.settings.update({ enhancedSampling: true, pixelArtScaler: 'sharp' });
  expect(h.setGraphicsEnhancements).toHaveBeenLastCalledWith({
    ...enhancementsOf(defaultSettings()),
    pixelArtScaler: 'sharp',
  });
});

it('switches weather live without touching the renderer enhancements', async () => {
  const h = harness();
  await h.settings.update({ weather: false });
  expect(h.setWeatherEnabled).toHaveBeenCalledWith(false);
  expect(h.setGraphicsEnhancements).not.toHaveBeenCalled();
  expect(h.persist).toHaveBeenCalledWith({ weather: false });
});

it('shows or hides the control-group numbers live, hidden until the player turns them on', async () => {
  expect(defaultSettings().groupNumbers).toBe(false);
  expect(parseStoredSettings('{"groupNumbers":"yes"}').groupNumbers).toBe(false);
  expect(parseStoredSettings('{"groupNumbers":true}').groupNumbers).toBe(true);
  const h = harness();
  await h.settings.update({ groupNumbers: true });
  expect(h.setGroupNumbersShown).toHaveBeenCalledWith(true);
  expect(h.persist).toHaveBeenCalledWith({ groupNumbers: true });
});

it('persists and switches blood immediately, including while paused', async () => {
  const h = harness();
  expect(h.settings.current().blood).toBe(true);
  await h.settings.update({ blood: false });
  expect(h.setBloodEnabled).toHaveBeenCalledWith(false);
  expect(h.persist).toHaveBeenCalledWith({ blood: false });
  await h.settings.update({ blood: true });
  expect(h.setBloodEnabled).toHaveBeenLastCalledWith(true);
});

it('fades bones by default and keeps them for good once switched off', async () => {
  const h = harness();
  expect(h.settings.current().bonesFade).toBe(true);
  await h.settings.update({ bonesFade: false });
  expect(h.setBonesFade).toHaveBeenCalledWith(false);
  expect(h.persist).toHaveBeenCalledWith({ bonesFade: false });
});

it('applies the background and mono sound choices live', async () => {
  const h = harness();
  await h.settings.update({ soundInBackground: true });
  await h.settings.update({ monoSound: true });
  expect(h.setSoundInBackground).toHaveBeenCalledWith(true);
  expect(h.setMonoSound).toHaveBeenCalledWith(true);
  expect(h.persist.mock.calls).toEqual([[{ soundInBackground: true }], [{ monoSound: true }]]);
});

it('applies the jingles switch and the unit responses choice to the driver live', async () => {
  const h = harness();
  await h.settings.update({ jinglesEnabled: false });
  await h.settings.update({ unitResponses: 'selection' });
  expect(h.setJinglesEnabled).toHaveBeenCalledWith(false);
  expect(h.setUnitResponses).toHaveBeenCalledWith('selection');
  expect(h.persist.mock.calls).toEqual([[{ jinglesEnabled: false }], [{ unitResponses: 'selection' }]]);
});

it('reframes the mounted minimap when another frame is picked', async () => {
  const h = harness();
  await h.settings.update({ minimapFrame: 'urnes' });
  expect(h.setMinimapFrame).toHaveBeenCalledWith('urnes');
  expect(h.persist).toHaveBeenCalledWith({ minimapFrame: 'urnes' });
});

function harness(overrides: Partial<GameSettingsRuntimeDeps> = {}) {
  const persist = vi.fn();
  const setUiScaleFactor = vi.fn(async () => true);
  const setSoundEnabled = vi.fn();
  const setVolumes = vi.fn();
  const setSoundInBackground = vi.fn();
  const setMonoSound = vi.fn();
  const setJinglesEnabled = vi.fn();
  const setUnitResponses = vi.fn();
  const setLanguage = vi.fn();
  const setKeyBindings = vi.fn();
  const setCameraInputSettings = vi.fn();
  const setDebugToolsEnabled = vi.fn();
  const setGraphicsEnhancements = vi.fn();
  const setMinimapFrame = vi.fn();
  const setSelectionStyle = vi.fn();
  const setGroupNumbersShown = vi.fn();
  const setWeatherEnabled = vi.fn();
  const setBloodEnabled = vi.fn();
  const setBonesFade = vi.fn();
  const settings = createGameSettingsRuntime({
    initial: {
      ...defaultSettings(),
      soundEnabled: true,
    },
    pinnedUiScale: null,
    effectiveUiScaleFor: (factor) => factor * 1.25,
    persist,
    setUiScaleFactor,
    setSoundEnabled,
    setVolumes,
    setSoundInBackground,
    setMonoSound,
    setJinglesEnabled,
    setUnitResponses,
    setLanguage,
    setKeyBindings,
    setCameraInputSettings,
    setDebugToolsEnabled,
    setGraphicsEnhancements,
    setSelectionStyle,
    setGroupNumbersShown,
    setMinimapFrame,
    setWeatherEnabled,
    setBloodEnabled,
    setBonesFade,
    ...overrides,
  });
  return {
    settings,
    persist,
    setUiScaleFactor,
    setSoundEnabled,
    setVolumes,
    setSoundInBackground,
    setMonoSound,
    setJinglesEnabled,
    setUnitResponses,
    setLanguage,
    setKeyBindings,
    setCameraInputSettings,
    setDebugToolsEnabled,
    setGraphicsEnhancements,
    setSelectionStyle,
    setGroupNumbersShown,
    setMinimapFrame,
    setWeatherEnabled,
    setBloodEnabled,
    setBonesFade,
  };
}

describe('createGameSettingsRuntime', () => {
  it('persists and applies each live setting through its matching runtime seam', async () => {
    const h = harness();

    await h.settings.update({ uiScaleFactor: 1.2 });
    await h.settings.update({ soundEnabled: false });
    await h.settings.update({ volumes: QUIET_WORLD });
    await h.settings.update({ debugToolsEnabled: true });
    await h.settings.update({
      keyboardScrollSpeed: 1.25,
      edgeScrollSpeed: 2.5,
      dragScrollSpeed: 1.75,
      edgeScrollEnabled: false,
      invertDragScroll: true,
    });
    const keyBindings = { ...defaultSettings().keyBindings, controlGroup1Replace: 'Alt+Digit1' };
    await h.settings.update({ keyBindings });

    expect(h.settings.current()).toMatchObject({
      uiScaleFactor: 1.2,
      soundEnabled: false,
      volumes: QUIET_WORLD,
      debugToolsEnabled: true,
      keyboardScrollSpeed: 1.25,
      edgeScrollSpeed: 2.5,
      dragScrollSpeed: 1.75,
      edgeScrollEnabled: false,
      invertDragScroll: true,
      keyBindings,
    });
    expect(h.persist.mock.calls).toEqual([
      [{ uiScaleFactor: 1.2 }],
      [{ soundEnabled: false }],
      [{ volumes: QUIET_WORLD }],
      [{ debugToolsEnabled: true }],
      [
        {
          keyboardScrollSpeed: 1.25,
          edgeScrollSpeed: 2.5,
          dragScrollSpeed: 1.75,
          edgeScrollEnabled: false,
          invertDragScroll: true,
        },
      ],
      [{ keyBindings }],
    ]);
    expect(h.setUiScaleFactor).toHaveBeenCalledWith(1.2);
    expect(h.setSoundEnabled).toHaveBeenCalledWith(false);
    expect(h.setVolumes).toHaveBeenCalledWith(QUIET_WORLD);
    expect(h.setDebugToolsEnabled).toHaveBeenCalledWith(true);
    expect(h.setCameraInputSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        keyboardScrollSpeed: 1.25,
        edgeScrollSpeed: 2.5,
        dragScrollSpeed: 1.75,
        edgeScrollEnabled: false,
        invertDragScroll: true,
      }),
    );
    expect(h.setKeyBindings).toHaveBeenCalledWith(keyBindings);
  });

  it('persists the complete settings model and projects the next-game language choice', async () => {
    const h = harness();

    await h.settings.update({ renderScale: 0.75, fpsLimit: 30, language: 'eng' });

    expect(h.settings.current()).toMatchObject({ renderScale: 0.75, fpsLimit: 30, language: 'eng' });
    expect(h.persist).toHaveBeenCalledWith({ renderScale: 0.75, fpsLimit: 30, language: 'eng' });
    expect(h.setLanguage).toHaveBeenCalledWith('eng');
  });

  it('commits later edits after an older settings patch finishes rebuilding the HUD', async () => {
    let finishScale = (_applied: boolean): void => undefined;
    const scaleResult = new Promise<boolean>((resolve) => {
      finishScale = resolve;
    });
    const h = harness({ setUiScaleFactor: vi.fn(() => scaleResult) });

    const restore = h.settings.update({ uiScaleFactor: 1.2, volumes: worldAt(20), displayMode: 'window' });
    const laterVolume = h.settings.update({ volumes: worldAt(90), displayMode: 'fullscreen' });
    await Promise.resolve();

    expect(h.persist).toHaveBeenCalledWith({ volumes: worldAt(90), displayMode: 'fullscreen' });
    expect(h.setVolumes).toHaveBeenCalledWith(worldAt(90));
    finishScale(true);
    await expect(Promise.all([restore, laterVolume])).resolves.toEqual([true, true]);

    expect(h.settings.current()).toMatchObject({
      uiScaleFactor: 1.2,
      volumes: worldAt(90),
      displayMode: 'fullscreen',
    });
    expect(h.persist.mock.calls).toEqual([
      [{ volumes: worldAt(90), displayMode: 'fullscreen' }],
      [{ uiScaleFactor: 1.2 }],
    ]);
  });

  it('keeps the previous value out of memory and storage when a scale replacement fails', async () => {
    const h = harness({ setUiScaleFactor: async () => false });

    await expect(h.settings.update({ uiScaleFactor: 1.3 })).resolves.toBe(false);

    expect(h.settings.current().uiScaleFactor).toBe(1);
    expect(h.persist).not.toHaveBeenCalled();
  });

  it('keeps a successful scale when the next queued scale fails', async () => {
    const setUiScaleFactor = vi
      .fn<(factor: number) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const h = harness({ setUiScaleFactor });

    const first = h.settings.update({ uiScaleFactor: 1.2 });
    const second = h.settings.update({ uiScaleFactor: 1.3 });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(h.settings.current().uiScaleFactor).toBe(1.2);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledWith({ uiScaleFactor: 1.2 });
  });

  it('commits every field from a successful full patch when the next full patch fails', async () => {
    const setUiScaleFactor = vi
      .fn<(factor: number) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const h = harness({ setUiScaleFactor });

    const first = h.settings.update({
      uiScaleFactor: 1.2,
      volumes: worldAt(20),
      language: 'pol',
      debugToolsEnabled: true,
    });
    const second = h.settings.update({
      uiScaleFactor: 1.3,
      volumes: worldAt(40),
      language: 'eng',
      debugToolsEnabled: false,
    });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(h.settings.current()).toMatchObject({
      uiScaleFactor: 1.2,
      volumes: worldAt(20),
      language: 'pol',
      debugToolsEnabled: true,
    });
    expect(h.setDebugToolsEnabled).toHaveBeenCalledTimes(1);
    expect(h.setDebugToolsEnabled).toHaveBeenCalledWith(true);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledWith({
      uiScaleFactor: 1.2,
      volumes: worldAt(20),
      language: 'pol',
      debugToolsEnabled: true,
    });
  });

  it('rolls a failed settings-to-viewport-to-HUD update back at every layer', async () => {
    const initialScale = uiScaleFor({ displayHeight: 600, viewportWidth: 800, viewportHeight: 600 });
    const target = {
      setUiScale: vi.fn(async (scale: number) => {
        if (scale !== initialScale) throw new Error('mount failed');
      }),
    };
    const perf = vi.fn();
    const hud = createGameHudScaleCoordinator({
      initialScale,
      targets: [target],
      placeDebugOverlays: perf,
      onError: vi.fn(),
    });
    const viewport = createGameViewportCoordinator({
      initialWidth: 800,
      initialHeight: 600,
      initialDisplayHeight: 600,
      initialUiScaleFactor: 1,
      pinnedUiScale: null,
      camera: () => ({ offsetX: 0, offsetY: 0 }),
      setCamera: vi.fn(),
      currentUiScale: hud.currentScale,
      requestUiScale: hud.request,
    });
    const h = harness({ setUiScaleFactor: viewport.setUiScaleFactor });

    await expect(h.settings.update({ uiScaleFactor: 1.3 })).resolves.toBe(false);

    expect(h.settings.current().uiScaleFactor).toBe(1);
    expect(viewport.uiScaleFactor()).toBe(1);
    expect(hud.currentScale()).toBe(initialScale);
    expect(h.persist).not.toHaveBeenCalled();
    expect(perf).toHaveBeenLastCalledWith(initialScale);
  });

  it('reports the effective and candidate UI scales supplied by the viewport owner', () => {
    const h = harness({
      pinnedUiScale: 1.75,
      effectiveUiScaleFor: () => 1.75,
    });

    expect(h.settings.pinnedUiScale).toBe(1.75);
    expect(h.settings.effectiveUiScaleFor(0.5)).toBe(1.75);
  });
});

describe('gameSoundEnabled', () => {
  it('uses storage without an override and lets an explicit URL choice win', () => {
    expect(gameSoundEnabled(new URLSearchParams(), false)).toBe(false);
    expect(gameSoundEnabled(new URLSearchParams('sound=off'), true)).toBe(false);
    expect(gameSoundEnabled(new URLSearchParams('sound=on'), false)).toBe(true);
  });
});

it('persists and applies every selection style immediately', async () => {
  const h = harness();
  for (const selectionStyle of ['outline', 'pulse', 'ring-white', 'ring-green'] as const) {
    await h.settings.update({ selectionStyle });
    expect(h.settings.current().selectionStyle).toBe(selectionStyle);
    expect(h.persist).toHaveBeenLastCalledWith({ selectionStyle });
    expect(h.setSelectionStyle).toHaveBeenLastCalledWith(selectionStyle);
  }
});
