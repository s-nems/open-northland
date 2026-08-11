import { describe, expect, it, vi } from 'vitest';
import { uiScaleFor } from '../src/hud/ui-scale.js';
import { createGameHudScaleCoordinator } from '../src/view/runtime/game-hud-scale.js';
import {
  createGameSettingsRuntime,
  type GameSettingsRuntimeDeps,
  gameSoundEnabled,
} from '../src/view/runtime/game-settings.js';
import { createGameViewportCoordinator } from '../src/view/runtime/game-viewport.js';

function harness(overrides: Partial<GameSettingsRuntimeDeps> = {}) {
  const persist = vi.fn();
  const setUiScaleFactor = vi.fn(async () => true);
  const setSoundEnabled = vi.fn();
  const setSfxVolume = vi.fn();
  const setMusicVolume = vi.fn();
  const settings = createGameSettingsRuntime({
    initial: {
      uiScaleFactor: 1,
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
    ...overrides,
  });
  return { settings, persist, setUiScaleFactor, setSoundEnabled, setSfxVolume, setMusicVolume };
}

describe('createGameSettingsRuntime', () => {
  it('persists and applies each live setting through its matching runtime seam', async () => {
    const h = harness();

    await h.settings.update({ uiScaleFactor: 1.2 });
    await h.settings.update({ soundEnabled: false });
    await h.settings.update({ soundVolume: 0.35 });
    await h.settings.update({ musicVolume: 0.45 });

    expect(h.settings.current()).toEqual({
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

  it('keeps the previous value out of memory and storage when a scale replacement fails', async () => {
    const h = harness({ setUiScaleFactor: async () => false });

    await expect(h.settings.update({ uiScaleFactor: 1.3 })).resolves.toBe(false);

    expect(h.settings.current().uiScaleFactor).toBe(1);
    expect(h.persist).not.toHaveBeenCalled();
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
      setPerfLeft: perf,
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
