import { type SoundBus, VOLUME_CHANNELS } from '@open-northland/audio';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSystemMenu, type SystemMenu } from '../src/hud/dom/system-menu.js';
import { currentLocale, messages, setActiveLocale } from '../src/i18n/index.js';
import type { GameSettingsRuntime } from '../src/view/runtime/game-settings.js';
import type { SaveLoadSession } from '../src/view/runtime/save-load/index.js';
import { defaultSettings } from '../src/view/settings-store.js';

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
  vi.unstubAllGlobals();
});

function mount(
  opts: {
    canLoad?: boolean;
    paused?: boolean;
    onNetwork?: () => void;
    previewBus?: (bus: SoundBus) => void;
  } = {},
) {
  const { previewBus, ...menuOpts } = opts;
  let paused = opts.paused ?? false;
  let beforeMenu = paused;
  let current = defaultSettings();
  let hudScale = 1;
  const saveLoad: SaveLoadSession = {
    worldToken: null,
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
    await Promise.resolve();
    expect(settings.current()).toMatchObject({ jinglesEnabled: false, unitResponses: 'selection' });
  });

  it('leaves the sliders without test buttons when there is no sound to preview', () => {
    const { menu } = mount();
    menu.toggle();
    openSettings();
    button(messages().mainMenu.settings.tabs.audio).click();
    expect(document.querySelector('.main-menu__settings-test')).toBeNull();
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
