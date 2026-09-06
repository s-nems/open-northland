import { describe, expect, it, vi } from 'vitest';
import { uiScaleFor } from '../src/hud/ui-scale.js';
import { createGameHudScaleCoordinator } from '../src/view/runtime/game-hud-scale.js';
import {
  createGameSettingsRuntime,
  type GameSettingsRuntimeDeps,
  gameSoundEnabled,
} from '../src/view/runtime/game-settings.js';
import { createGameViewportCoordinator } from '../src/view/runtime/game-viewport.js';
import { defaultSettings } from '../src/view/settings-store.js';

function harness(overrides: Partial<GameSettingsRuntimeDeps> = {}) {
  const persist = vi.fn();
  const setUiScaleFactor = vi.fn(async () => true);
  const setSoundEnabled = vi.fn();
  const setSfxVolume = vi.fn();
  const setMusicVolume = vi.fn();
  const setLanguage = vi.fn();
  const settings = createGameSettingsRuntime({
    initial: {
      ...defaultSettings(),
      soundEnabled: true,
      soundVolume: 1,
      musicVolume: 0.7,
    },
    pinnedUiScale: null,
    effectiveUiScaleFor: (factor) => factor * 1.25,
    persist,
    setUiScaleFactor,
    setSoundEnabled,
    setSfxVolume,
    setMusicVolume,
    setLanguage,
    ...overrides,
  });
  return {
    settings,
    persist,
    setUiScaleFactor,
    setSoundEnabled,
    setSfxVolume,
    setMusicVolume,
    setLanguage,
  };
}

describe('createGameSettingsRuntime', () => {
  it('persists and applies each live setting through its matching runtime seam', async () => {
    const h = harness();

    await h.settings.update({ uiScaleFactor: 1.2 });
    await h.settings.update({ soundEnabled: false });
    await h.settings.update({ soundVolume: 0.35 });
    await h.settings.update({ musicVolume: 0.45 });

    expect(h.settings.current()).toMatchObject({
      uiScaleFactor: 1.2,
      soundEnabled: false,
      soundVolume: 0.35,
      musicVolume: 0.45,
    });
    expect(h.persist.mock.calls).toEqual([
      [{ uiScaleFactor: 1.2 }],
      [{ soundEnabled: false }],
      [{ soundVolume: 0.35 }],
      [{ musicVolume: 0.45 }],
    ]);
    expect(h.setUiScaleFactor).toHaveBeenCalledWith(1.2);
    expect(h.setSoundEnabled).toHaveBeenCalledWith(false);
    expect(h.setSfxVolume).toHaveBeenCalledWith(0.35);
    expect(h.setMusicVolume).toHaveBeenCalledWith(0.45);
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

    const restore = h.settings.update({ uiScaleFactor: 1.2, soundVolume: 0.2, displayMode: 'window' });
    const laterVolume = h.settings.update({ soundVolume: 0.9, displayMode: 'fullscreen' });
    await Promise.resolve();

    expect(h.persist).toHaveBeenCalledWith({ soundVolume: 0.9, displayMode: 'fullscreen' });
    expect(h.setSfxVolume).toHaveBeenCalledWith(0.9);
    finishScale(true);
    await expect(Promise.all([restore, laterVolume])).resolves.toEqual([true, true]);

    expect(h.settings.current()).toMatchObject({
      uiScaleFactor: 1.2,
      soundVolume: 0.9,
      displayMode: 'fullscreen',
    });
    expect(h.persist.mock.calls).toEqual([
      [{ soundVolume: 0.9, displayMode: 'fullscreen' }],
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

    const first = h.settings.update({ uiScaleFactor: 1.2, soundVolume: 0.2, language: 'pol' });
    const second = h.settings.update({ uiScaleFactor: 1.3, soundVolume: 0.4, language: 'eng' });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(h.settings.current()).toMatchObject({ uiScaleFactor: 1.2, soundVolume: 0.2, language: 'pol' });
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledWith({
      uiScaleFactor: 1.2,
      soundVolume: 0.2,
      language: 'pol',
    });
  });

  it('rolls a failed settings-to-viewport-to-HUD update back at every layer', async () => {
    const initialScale = uiScaleFor(600);
    const target = {
      setUiScale: vi.fn(async (scale: number) => {
        if (scale !== initialScale) throw new Error('mount failed');
      }),
    };
    const perf = vi.fn();
    const hud = createGameHudScaleCoordinator({
      initialScale,
      targets: [target],
      placePerf: perf,
      onError: vi.fn(),
    });
    const viewport = createGameViewportCoordinator({
      initialWidth: 800,
      initialHeight: 600,
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
