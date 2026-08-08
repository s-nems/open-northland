import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptSettings, carriedSettingParams } from '../src/entries/main-menu/settings-state.js';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import { UI_SCALE_FACTOR_MAX, UI_SCALE_FACTOR_MIN } from '../src/hud/ui-scale.js';
import type { MenuSettings } from '../src/view/settings-store.js';
import {
  defaultSettings,
  parseStoredSettings,
  persistSettings,
  RENDER_SCALE_MAX,
  RENDER_SCALE_MIN,
} from '../src/view/settings-store.js';

// The default language, and so the param the URL elides, comes from the browser rather than a constant.
beforeEach(() => vi.stubGlobal('navigator', { languages: ['pl-PL'] }));
afterEach(() => vi.unstubAllGlobals());

describe('parseStoredSettings', () => {
  it('falls back to defaults for an empty store, garbage, or a non-object', () => {
    expect(parseStoredSettings(null)).toEqual(defaultSettings());
    expect(parseStoredSettings('not json')).toEqual(defaultSettings());
    expect(parseStoredSettings('42')).toEqual(defaultSettings());
    expect(parseStoredSettings('null')).toEqual(defaultSettings());
  });

  it('round-trips a full settings object', () => {
    const settings = {
      displayMode: 'fullscreen',
      renderScale: 0.75,
      uiScaleFactor: 1.25,
      postFxEnabled: false,
      fpsLimit: 30,
      soundEnabled: false,
      language: 'eng',
      keyBindings: { ...DEFAULT_KEY_BINDINGS, pauseToggle: 'KeyO' },
    } as const;
    expect(parseStoredSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it('falls back per field, not per blob', () => {
    const parsed = parseStoredSettings(
      '{"language":"eng","uiScaleFactor":"big","displayMode":"borderless","renderScale":"max","postFxEnabled":1,"fpsLimit":45}',
    );
    expect(parsed.language).toBe('eng');
    expect(parsed.uiScaleFactor).toBe(defaultSettings().uiScaleFactor);
    expect(parsed.displayMode).toBe('window');
    expect(parsed.renderScale).toBe(defaultSettings().renderScale);
    expect(parsed.postFxEnabled).toBe(defaultSettings().postFxEnabled);
    expect(parsed.fpsLimit).toBeNull();
    expect(parsed.soundEnabled).toBe(defaultSettings().soundEnabled);
    expect(parsed.keyBindings).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('clamps an out-of-range stored factor instead of dropping it', () => {
    expect(parseStoredSettings('{"uiScaleFactor":9}').uiScaleFactor).toBe(UI_SCALE_FACTOR_MAX);
    expect(parseStoredSettings('{"uiScaleFactor":0.1}').uiScaleFactor).toBe(UI_SCALE_FACTOR_MIN);
    expect(parseStoredSettings('{"renderScale":9}').renderScale).toBe(RENDER_SCALE_MAX);
    expect(parseStoredSettings('{"renderScale":0.1}').renderScale).toBe(RENDER_SCALE_MIN);
  });

  it('ignores the pre-relative absolute `uiScale` field', () => {
    expect(parseStoredSettings('{"uiScale":1.75}').uiScaleFactor).toBe(defaultSettings().uiScaleFactor);
  });

  it('starts a player with nothing stored in the browser language, English when it ships no catalog', () => {
    vi.stubGlobal('navigator', { languages: ['en-GB'] });
    expect(parseStoredSettings(null).language).toBe('eng');
    vi.stubGlobal('navigator', { languages: ['zh-CN'] });
    expect(parseStoredSettings(null).language).toBe('eng');
    vi.stubGlobal('navigator', { languages: ['pl'] });
    expect(parseStoredSettings(null).language).toBe('pol');
  });

  it('keeps a stored language over the browser one - the settings screen only ever overrides', () => {
    vi.stubGlobal('navigator', { languages: ['en-GB'] });
    expect(parseStoredSettings('{"language":"pol"}').language).toBe('pol');
    vi.stubGlobal('navigator', { languages: ['pl-PL'] });
    expect(parseStoredSettings('{"language":"eng"}').language).toBe('eng');
  });
});

describe('persistSettings', () => {
  function storedBlob(settings: MenuSettings): Record<string, unknown> {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { setItem } });
    persistSettings(settings);
    return JSON.parse(String(setItem.mock.calls[0]?.[1])) as Record<string, unknown>;
  }

  it('stores a language the player picked over the browser one', () => {
    expect(storedBlob({ ...defaultSettings(), language: 'eng' }).language).toBe('eng');
  });

  it('leaves out a language matching the browser, so a later browser change still reaches the player', () => {
    const blob = storedBlob({ ...defaultSettings(), soundEnabled: false });
    expect('language' in blob).toBe(false);
    expect(blob.soundEnabled).toBe(false);
  });
});

describe('adoptSettings', () => {
  const stored = { ...defaultSettings(), language: 'eng', soundEnabled: false } as const;

  it('adopts stored non-defaults into empty params and reports them for the URL', () => {
    const params = new URLSearchParams('');
    const { session, adopted } = adoptSettings(stored, params);
    expect(session).toEqual(stored);
    expect(params.get('lang')).toBe('eng');
    expect(params.get('sound')).toBe('off');
    expect(adopted).toEqual([
      { param: 'lang', value: 'eng' },
      { param: 'sound', value: 'off' },
    ]);
  });

  it('lets an explicit URL param win for the session without reporting it as adopted', () => {
    const params = new URLSearchParams('lang=pol');
    const { session, adopted } = adoptSettings(stored, params);
    expect(session.language).toBe('pol');
    expect(adopted).toEqual([{ param: 'sound', value: 'off' }]);
  });

  it('never puts the HUD scale factor or the graphics settings into the URL', () => {
    const params = new URLSearchParams('');
    adoptSettings(
      { ...defaultSettings(), uiScaleFactor: 1.25, renderScale: 0.5, postFxEnabled: false, fpsLimit: 30 },
      params,
    );
    expect([...params.keys()]).toEqual([]);
  });
});

describe('carriedSettingParams', () => {
  it('elides every param at defaults, so a clean URL stays clean', () => {
    expect(carriedSettingParams(defaultSettings()).every((row) => row.value === null)).toBe(true);
  });

  it('projects non-default values onto lang/sound and keeps store-only settings out', () => {
    const rows = carriedSettingParams({
      ...defaultSettings(),
      language: 'eng',
      uiScaleFactor: 1.25,
      renderScale: 2,
      postFxEnabled: false,
      fpsLimit: 60,
      soundEnabled: false,
    });
    expect(rows).toEqual([
      { key: 'language', param: 'lang', value: 'eng' },
      { key: 'soundEnabled', param: 'sound', value: 'off' },
    ]);
  });
});
