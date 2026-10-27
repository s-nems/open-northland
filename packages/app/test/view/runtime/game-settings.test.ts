import { DEFAULT_VOLUMES, type MixerVolumes } from '@open-northland/audio';
import { describe, expect, it, vi } from 'vitest';
import { uiScaleFor } from '../../../src/hud/ui-scale.js';
import { enhancementsOf } from '../../../src/view/graphics/enhancements.js';
import { createGameHudScaleCoordinator } from '../../../src/view/runtime/game-hud-scale.js';
import {
  createGameSettingsRuntime,
  type GameSettingsRuntimeDeps,
  gameSoundEnabled,
} from '../../../src/view/runtime/game-settings.js';
import { createGameViewportCoordinator } from '../../../src/view/runtime/game-viewport.js';
import { defaultSettings, parseStoredSettings } from '../../../src/view/settings/store.js';

/** The default mix with only the world bus moved to `world`. */
const worldAt = (world: number): MixerVolumes => ({ ...DEFAULT_VOLUMES, world });
const QUIET_WORLD = worldAt(35);

type SettingsPatch = Parameters<ReturnType<typeof harness>['settings']['update']>[0];
type Seam = Exclude<keyof ReturnType<typeof harness>, 'settings' | 'persist'>;

/** A setting the running game applies at once: the patch, the seam that takes it, and what it is handed. */
interface LiveSetting {
  readonly patch: SettingsPatch;
  readonly seam: Seam;
  readonly applied: unknown;
}

const LIVE_SETTINGS: readonly LiveSetting[] = [
  {
    patch: { softShadows: false },
    seam: 'setGraphicsEnhancements',
    applied: { ...enhancementsOf(defaultSettings()), softShadows: false },
  },
  {
    patch: { enhancedSampling: true, pixelArtScaler: 'xbrz' },
    seam: 'setGraphicsEnhancements',
    applied: { ...enhancementsOf(defaultSettings()), pixelArtScaler: 'xbrz' },
  },
  { patch: { weather: false }, seam: 'setWeatherEnabled', applied: false },
  { patch: { groupNumbers: true }, seam: 'setGroupNumbersShown', applied: true },
  { patch: { blood: false }, seam: 'setBloodEnabled', applied: false },
  { patch: { bonesFade: false }, seam: 'setBonesFade', applied: false },
  { patch: { fpsCounter: true }, seam: 'setFpsCounterShown', applied: true },
  { patch: { fpsLimit: 30 }, seam: 'setFpsLimit', applied: 30 },
  { patch: { fpsLimit: null }, seam: 'setFpsLimit', applied: null },
  { patch: { soundInBackground: true }, seam: 'setSoundInBackground', applied: true },
  { patch: { monoSound: true }, seam: 'setMonoSound', applied: true },
  { patch: { jinglesEnabled: false }, seam: 'setJinglesEnabled', applied: false },
  { patch: { unitResponses: 'selection' }, seam: 'setUnitResponses', applied: 'selection' },
  { patch: { minimapFrame: 'urnes' }, seam: 'setMinimapFrame', applied: 'urnes' },
  ...(['outline', 'pulse', 'ring-white', 'ring-green'] as const).map(
    (selectionStyle): LiveSetting => ({
      patch: { selectionStyle },
      seam: 'setSelectionStyle',
      applied: selectionStyle,
    }),
  ),
  { patch: { hoverOutline: false }, seam: 'setHoverOutline', applied: false },
  { patch: { hoverOutline: true }, seam: 'setHoverOutline', applied: true },
];

describe('a live setting', () => {
  it.each(LIVE_SETTINGS)('$patch reaches $seam at once and persists', async ({ patch, seam, applied }) => {
    const h = harness();
    await h.settings.update(patch);
    expect(h.settings.current()).toMatchObject(patch);
    expect(h.persist).toHaveBeenCalledWith(patch);
    expect(h[seam]).toHaveBeenLastCalledWith(applied);
    if (seam !== 'setGraphicsEnhancements') expect(h.setGraphicsEnhancements).not.toHaveBeenCalled();
  });

  it('hides group numbers until opted in, fades bones by default, and reads group numbers only as a boolean', () => {
    expect(defaultSettings().groupNumbers).toBe(false);
    expect(defaultSettings().bonesFade).toBe(true);
    expect(parseStoredSettings('{"groupNumbers":"yes"}').groupNumbers).toBe(false);
    expect(parseStoredSettings('{"groupNumbers":true}').groupNumbers).toBe(true);
  });

  it('shows the hovered-target outline by default and reads it only as a boolean', () => {
    expect(defaultSettings().hoverOutline).toBe(true);
    expect(parseStoredSettings('{"hoverOutline":"yes"}').hoverOutline).toBe(true);
    expect(parseStoredSettings('{"hoverOutline":false}').hoverOutline).toBe(false);
    expect(parseStoredSettings('{}').hoverOutline).toBe(true);
  });
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
  const setHoverOutline = vi.fn();
  const setGroupNumbersShown = vi.fn();
  const setWeatherEnabled = vi.fn();
  const setBloodEnabled = vi.fn();
  const setBonesFade = vi.fn();
  const setFpsCounterShown = vi.fn();
  const setFpsLimit = vi.fn();
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
    setHoverOutline,
    setGroupNumbersShown,
    setMinimapFrame,
    setWeatherEnabled,
    setBloodEnabled,
    setBonesFade,
    setFpsCounterShown,
    setFpsLimit,
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
    setHoverOutline,
    setGroupNumbersShown,
    setMinimapFrame,
    setWeatherEnabled,
    setBloodEnabled,
    setBonesFade,
    setFpsCounterShown,
    setFpsLimit,
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
    const hud = createGameHudScaleCoordinator({
      initialScale,
      targets: [target],
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
