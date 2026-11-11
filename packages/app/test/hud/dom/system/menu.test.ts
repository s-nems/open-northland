import { type SoundBus, VOLUME_CHANNELS } from '@open-northland/audio';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayOffer } from '../../../../src/hud/dom/match-result.js';
import { createSystemMenu, type SystemMenu } from '../../../../src/hud/dom/system/menu.js';
import { currentLocale, messages, setActiveLocale } from '../../../../src/i18n/index.js';
import * as graphicsStartup from '../../../../src/view/graphics/startup.js';
import type { GameSettingsRuntime } from '../../../../src/view/runtime/game-settings.js';
import type { SaveLoadSession } from '../../../../src/view/runtime/save-load/index.js';
import { noteRestartOnLeave } from '../../../../src/view/runtime/settings-restart.js';
import { defaultSettings, type MenuSettings } from '../../../../src/view/settings/store.js';

let menu: SystemMenu | null = null;
let notifyHudResize = (): void => undefined;
const locale = currentLocale();
beforeEach(() => {
  setActiveLocale('eng');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyHudResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
});
afterEach(() => {
  menu?.dispose();
  menu = null;
  document.body.replaceChildren();
  setActiveLocale(locale);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(
  opts: {
    canLoad?: boolean;
    paused?: boolean;
    onNetwork?: () => void;
    restart?: ReplayOffer;
    previewBus?: (bus: SoundBus) => void;
    onSettingsLeft?: (opened: MenuSettings, closed: MenuSettings) => void;
  } = {},
) {
  const { previewBus, ...menuOpts } = opts;
  let paused = opts.paused ?? false;
  let beforeMenu = paused;
  let current = defaultSettings();
  let hudScale = 1;
  const saveLoad: SaveLoadSession = {
    worldToken: null,
    worldSeed: null,
    listSaves: async () => [],
    saveGame: async () => ({ kind: 'saved' }),
    stageForReload: async () => undefined,
    loadSave: async () => ({ kind: 'cancelled' }),
    loadFromFile: async () => ({ kind: 'cancelled' }),
    exportSave: async () => ({ kind: 'saved' }),
    deleteSave: async () => undefined,
    forcePause: vi.fn(() => {
      beforeMenu = paused;
      paused = true;
    }),
    releaseForcedPause: vi.fn(() => {
      paused = beforeMenu;
    }),
  };
  const settings: GameSettingsRuntime = {
    current: () => current,
    pinnedUiScale: null,
    bootOwnedChangesDeferred: true,
    inGame: true,
    effectiveUiScaleFor: (factor) => factor,
    update: async (patch) => {
      current = { ...current, ...patch };
      return true;
    },
    ...(previewBus !== undefined ? { previewBus } : {}),
  };
  const onQuit = vi.fn();
  menu = createSystemMenu({
    saveLoad,
    settings,
    hud: { element: document.createElement('div'), currentScale: () => hudScale },
    onQuit,
    setCameraSuspended: vi.fn(),
    ...menuOpts,
  });
  return {
    menu,
    saveLoad,
    settings,
    onQuit,
    paused: () => paused,
    setHudScale: (scale: number) => {
      hudScale = scale;
      notifyHudResize();
    },
  };
}
function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === label || el.getAttribute('aria-label') === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return found;
}
function key(value: string, code = value): void {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: value, code, bubbles: true, cancelable: true }),
  );
}
function openSettings(): void {
  button(messages().mainMenu.items.settings).click();
}

describe('system menu navigation', () => {
  it('closes on a backdrop click but not on a drag released there from inside the save window', () => {
    const { menu } = mount();
    menu.toggle();
    button(messages().hud.saveGame).click();
    const backdrop = document.querySelector<HTMLElement>('.on-system-backdrop');
    const name = document.querySelector<HTMLInputElement>('.on-saves input[type="text"]');
    if (backdrop === null || name === null) throw new Error('Missing save window');
    const press = (down: HTMLElement, up: HTMLElement): void => {
      down.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      up.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      // A click lands on the nearest element holding both the press and the release.
      (down === up ? up : backdrop).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    press(name, backdrop);
    expect(menu.isOpen()).toBe(true);
    press(backdrop, name);
    expect(menu.isOpen()).toBe(true);
    press(backdrop, backdrop);
    expect(menu.isOpen()).toBe(false);
  });

  it('follows the scale applied by the HUD when its viewport settles', async () => {
    const state = mount();
    state.menu.toggle();
    openSettings();
    await state.settings.update({ uiScaleFactor: 1.5 });
    const plane = document.querySelector<HTMLElement>('.on-system-plane');
    expect(plane?.style.getPropertyValue('--hud-scale')).toBe('1');
    state.setHudScale(1.75);
    expect(plane?.style.getPropertyValue('--hud-scale')).toBe('1.75');
    expect(document.querySelector<HTMLInputElement>('[data-settings-focus="ui-scale"]')?.value).toBe('1.5');
    expect(state.menu.isOpen()).toBe(true);
  });

  it.each([false, true])(
    'restores the prior pause (%s) and focus after backing out of settings',
    (paused) => {
      const trigger = document.createElement('button');
      document.body.append(trigger);
      trigger.focus();
      const state = mount({ paused });
      state.menu.toggle();
      expect(state.paused()).toBe(true);
      expect(trigger.inert).toBe(true);
      openSettings();
      key('Escape');
      expect(state.menu.isOpen()).toBe(true);
      expect(document.activeElement).toBe(button(messages().mainMenu.items.settings));
      key('Escape');
      expect(state.paused()).toBe(paused);
      expect(state.saveLoad.forcePause).toHaveBeenCalledOnce();
      expect(state.saveLoad.releaseForcedPause).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(trigger);
      expect(trigger.inert).not.toBe(true);
    },
  );

  it('keeps Tab inside the menu and gives Escape to a confirmation before the menu', async () => {
    const { menu, onQuit } = mount();
    menu.toggle();
    const resume = document.querySelector<HTMLButtonElement>('.on-system-menu__resume');
    resume?.focus();
    resume?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement?.tagName).toBe('SUMMARY');
    key('Tab');
    expect(document.activeElement).toBe(resume);
    button(messages().hud.systemMenuDetails.leaveGame).click();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    key('Escape');
    await Promise.resolve();
    expect(onQuit).not.toHaveBeenCalled();
    expect(menu.isOpen()).toBe(true);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    button(messages().hud.systemMenuDetails.leaveGame).click();
    const question = document.querySelector('[role="alertdialog"]');
    if (question === null) throw new Error('Missing confirmation');
    button(messages().hud.quitConfirmYes, question).click();
    await Promise.resolve();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it('restarts the main map only after its confirmation, and offers no restart without a replay', async () => {
    const start = vi.fn();
    const { menu } = mount({ restart: { scope: 'mainMap', start } });
    menu.toggle();
    const restart = messages().hud.systemMenuDetails.restartMap;
    button(restart).click();
    button(messages().hud.systemMenuDetails.cancel).click();
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
    button(restart).click();
    const question = document.querySelector('[role="alertdialog"]');
    if (question === null) throw new Error('Missing confirmation');
    expect(question.textContent).toContain(messages().hud.playAgainMainMapConfirm);
    button(restart, question).click();
    await Promise.resolve();
    expect(start).toHaveBeenCalledOnce();
    menu.dispose();
    mount().menu.toggle();
    expect(document.querySelector('.on-system-menu')?.textContent).not.toContain(restart);
  });

  it('refuses loading in multiplayer and releases the menu before opening Network', () => {
    const onNetwork = vi.fn();
    const { menu, saveLoad } = mount({ canLoad: false, onNetwork });
    menu.openPage('load');
    expect(menu.isOpen()).toBe(false);
    expect(saveLoad.forcePause).not.toHaveBeenCalled();
    menu.toggle();
    const root = document.querySelector('.on-system-menu');
    expect(root?.textContent).not.toContain(messages().hud.loadGame);
    button(messages().hud.network.title).click();
    expect(menu.isOpen()).toBe(false);
    expect(onNetwork).toHaveBeenCalledOnce();
    expect(saveLoad.releaseForcedPause).toHaveBeenCalledOnce();
  });

  it('reports a page closing once, back through the menu, and not on dispose', () => {
    const { menu } = mount();
    const onClosed = vi.fn();
    menu.openPage('load', onClosed);
    key('Escape');
    expect(menu.isOpen()).toBe(true);
    expect(onClosed).not.toHaveBeenCalled();
    key('Escape');
    expect(menu.isOpen()).toBe(false);
    expect(onClosed).toHaveBeenCalledOnce();
    menu.toggle();
    menu.toggle();
    expect(onClosed).toHaveBeenCalledOnce();
    menu.openPage('load', onClosed);
    menu.dispose();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('cancels a hidden key capture when the settings close', async () => {
    const { menu, settings } = mount();
    menu.toggle();
    openSettings();
    button(messages().mainMenu.settings.tabs.controls).click();
    const chip = document.querySelector<HTMLButtonElement>('[data-settings-focus="binding:pauseToggle"]');
    const prior = settings.current().keyBindings.pauseToggle;
    chip?.click();
    expect(chip?.classList.contains('is-capturing')).toBe(true);
    menu.toggle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true }));
    await Promise.resolve();
    expect(settings.current().keyBindings.pauseToggle).toBe(prior);
  });

  it('applies live audio settings and requires confirmation before resetting all categories', async () => {
    const { menu, settings } = mount();
    menu.toggle();
    openSettings();
    button(messages().mainMenu.settings.tabs.audio).click();
    for (const channel of VOLUME_CHANNELS) {
      expect(document.querySelector(`[data-settings-focus="${channel}-volume"]`)).not.toBeNull();
    }
    document.querySelector<HTMLButtonElement>('[data-settings-focus="music-source:1"]')?.click();
    expect(settings.current().musicSource).toBe('nation');
    const input = document.querySelector<HTMLInputElement>('[data-settings-focus="world-volume"]');
    if (input === null) throw new Error('Missing volume slider');
    input.value = '23';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(settings.current().volumes.world).toBe(23);
    button(messages().mainMenu.settings.restoreDefaults).click();
    key('Escape');
    await Promise.resolve();
    expect(settings.current().volumes.world).toBe(23);
    button(messages().mainMenu.settings.restoreDefaults).click();
    const question = document.querySelector('[role="alertdialog"]');
    if (question === null) throw new Error('Missing confirmation');
    button(messages().mainMenu.settings.restoreDefaults, question).click();
    await vi.waitFor(() => expect(settings.current().volumes).toEqual(defaultSettings().volumes));
  });

  it.each(['edit', 'dispose'] as const)('does not apply a delayed reset after a later %s', async (action) => {
    let finishRecommendation: (settings: MenuSettings) => void = () => undefined;
    const recommendation = new Promise<MenuSettings>((resolve) => {
      finishRecommendation = resolve;
    });
    const recommend = vi.spyOn(graphicsStartup, 'recommendedSettings').mockReturnValue(recommendation);
    const { menu, settings } = mount();
    await settings.update({ soundEnabled: false });
    menu.toggle();
    openSettings();
    const restore = button(messages().mainMenu.settings.restoreDefaults);
    restore.click();
    const question = document.querySelector('[role="alertdialog"]');
    if (question === null) throw new Error('Missing confirmation');
    button(messages().mainMenu.settings.restoreDefaults, question).click();
    await vi.waitFor(() => expect(recommend).toHaveBeenCalledOnce());

    if (action === 'edit') button(messages().mainMenu.settings.weather).click();
    else menu.dispose();
    const chosen = settings.current();
    expect(chosen.soundEnabled).toBe(false);
    expect(chosen.weather).toBe(action !== 'edit');
    finishRecommendation(defaultSettings());
    await vi.waitFor(() => expect(restore.disabled).toBe(false));

    expect(settings.current()).toEqual(chosen);
  });

  it('cancels a pending reset when a later UI scale choice is still rebuilding', async () => {
    let finishRecommendation: (settings: MenuSettings) => void = () => undefined;
    const recommendation = new Promise<MenuSettings>((resolve) => {
      finishRecommendation = resolve;
    });
    const recommend = vi.spyOn(graphicsStartup, 'recommendedSettings').mockReturnValue(recommendation);
    const { menu, settings } = mount();
    await settings.update({ soundEnabled: false });
    const before = settings.current();
    const commitSettings = settings.update;
    let finishRebuild = (): void => undefined;
    const rebuild = new Promise<void>((resolve) => {
      finishRebuild = resolve;
    });
    const update = vi.spyOn(settings, 'update').mockImplementation(async (patch) => {
      await rebuild;
      return commitSettings(patch);
    });
    menu.toggle();
    openSettings();
    const restore = button(messages().mainMenu.settings.restoreDefaults);
    restore.click();
    const question = document.querySelector('[role="alertdialog"]');
    if (question === null) throw new Error('Missing confirmation');
    button(messages().mainMenu.settings.restoreDefaults, question).click();
    await vi.waitFor(() => expect(recommend).toHaveBeenCalledOnce());

    const scale = document.querySelector<HTMLInputElement>('[data-settings-focus="ui-scale"]');
    if (scale === null) throw new Error('Missing UI scale slider');
    scale.value = '1.5';
    scale.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.current()).toBe(before);
    finishRecommendation(defaultSettings());
    await vi.waitFor(() => expect(restore.disabled).toBe(false));

    expect(update).toHaveBeenCalledExactlyOnceWith({ uiScaleFactor: 1.5 });
    finishRebuild();
    await vi.waitFor(() =>
      expect(settings.current()).toMatchObject({ uiScaleFactor: 1.5, soundEnabled: false }),
    );
  });

  it('plays a bus preview beside each slider that has one, and sets the jingles and responses', async () => {
    const previewBus = vi.fn();
    const { menu, settings } = mount({ previewBus });
    menu.toggle();
    openSettings();
    button(messages().mainMenu.settings.tabs.audio).click();
    document.querySelector<HTMLButtonElement>('[data-settings-focus="world-test"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-settings-focus="responses-test"]')?.click();
    expect(previewBus.mock.calls).toEqual([['world'], ['responses']]);
    // The master and the music keep a hidden button, so the sliders line up.
    expect(document.querySelector('[data-settings-focus="master-test"]')).toBeNull();
    expect(document.querySelectorAll('.main-menu__settings-test.is-placeholder')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('[data-settings-focus="jingles"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-settings-focus="unit-responses:1"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-settings-focus="sound-quality:1"]')?.click();
    await Promise.resolve();
    expect(settings.current()).toMatchObject({
      jinglesEnabled: false,
      unitResponses: 'selection',
      soundQuality: 'compact',
    });
    // The picked segment shows at once, before any re-render of the page.
    const pressed = (prefix: string): string[] =>
      [...document.querySelectorAll<HTMLButtonElement>(`[data-settings-focus^="${prefix}:"]`)].map(
        (b) => b.getAttribute('aria-pressed') ?? '',
      );
    expect(pressed('unit-responses')).toEqual(['false', 'true', 'false']);
    expect(pressed('sound-quality')).toEqual(['false', 'true']);
  });

  it('closes on request as the resume button would', () => {
    const state = mount();
    state.menu.toggle();
    expect(state.menu.isOpen()).toBe(true);
    state.menu.close();
    expect(state.menu.isOpen()).toBe(false);
    expect(state.saveLoad.releaseForcedPause).toHaveBeenCalledOnce();
    state.menu.close();
    expect(state.saveLoad.releaseForcedPause).toHaveBeenCalledOnce();
  });

  it('raises one restart note per settings visit that leaves a restart-bound setting changed', async () => {
    const note = vi.fn();
    const state = mount({ onSettingsLeft: noteRestartOnLeave(defaultSettings(), note) });
    state.menu.toggle();
    expect(note).not.toHaveBeenCalled();

    // Backing out with Escape, a change kept.
    openSettings();
    await state.settings.update({ renderScale: 0.5, fpsLimit: 30 });
    key('Escape');
    expect(note).toHaveBeenCalledExactlyOnceWith([messages().mainMenu.settings.renderScale]);

    // Resuming from the page, a change undone before it closed.
    note.mockClear();
    openSettings();
    await state.settings.update({ postFxEnabled: !state.settings.current().postFxEnabled });
    await state.settings.update({ postFxEnabled: !state.settings.current().postFxEnabled });
    state.menu.close();
    expect(note).not.toHaveBeenCalled();

    // The menu closing over the page, as a lost link closes it; the earlier change still waits.
    state.menu.toggle();
    openSettings();
    await state.settings.update({ spriteSmoothing: !state.settings.current().spriteSmoothing });
    state.menu.close();
    state.menu.close();
    const labels = messages().mainMenu.settings;
    expect(note).toHaveBeenCalledExactlyOnceWith([labels.renderScale, labels.spriteSmoothing]);
  });

  it('disposal releases an open menu and restores inert siblings', () => {
    const state = mount();
    state.menu.toggle();
    openSettings();
    state.menu.dispose();
    menu = null;
    expect(state.paused()).toBe(false);
    expect(document.querySelector('.on-system-backdrop')).toBeNull();
  });
});
