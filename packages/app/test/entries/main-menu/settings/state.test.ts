import { DEFAULT_VOLUMES } from '@open-northland/audio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptSettings, carriedSettingParams } from '../../../../src/entries/main-menu/settings/state.js';
import { DEFAULT_KEY_BINDINGS } from '../../../../src/hud/keybindings.js';
import { UI_SCALE_FACTOR_MAX, UI_SCALE_FACTOR_MIN } from '../../../../src/hud/ui-scale.js';
import type { MenuSettings } from '../../../../src/view/settings/store.js';
import {
  defaultSettings,
  parseStoredSettings,
  patchStoredSettings,
  persistSettings,
  RENDER_SCALE_MAX,
  RENDER_SCALE_MIN,
  SCROLL_SPEED_MAX,
  SCROLL_SPEED_MIN,
} from '../../../../src/view/settings/store.js';

// The default language, and so the param the URL elides, comes from the browser rather than a constant.
beforeEach(() => vi.stubGlobal('navigator', { languages: ['pl-PL'] }));
afterEach(() => vi.unstubAllGlobals());

describe('parseStoredSettings', () => {
  it.each(['ger', 'rus', 'chs', 'cht'] as const)('retains a stored %s language choice', (language) => {
    expect(parseStoredSettings(JSON.stringify({ language })).language).toBe(language);
  });
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
      backingDensity: 'whole',
      uiScaleFactor: 1.25,
      postFxEnabled: false,
      spriteSmoothing: false,
      enhancedSampling: false,
      pixelArtScaler: 'xbrz',
      softShadows: true,
      enhancedWater: false,
      environmentMotion: false,
      groundedBuildings: false,
      buildingDamage: false,
      weather: false,
      blood: false,
      bonesFade: false,
      fpsLimit: 30,
      fpsCounter: true,
      cursorTheme: 'amber',
      cursorSize: 24,
      selectionStyle: 'outline',
      hoverOutline: false,
      groupNumbers: true,
      minimapFrame: 'urnes',
      minimapFilters: {
        layers: {
          civilians: true,
          soldiers: true,
          heroes: false,
          buildings: false,
          vehicles: true,
          animals: false,
          roads: true,
          signposts: true,
        },
        scope: 'hostile',
        ground: 'muted',
        markerSize: 'small',
        colours: 'stance',
      },
      soundEnabled: false,
      volumes: { master: 65, music: 40, responses: 90, world: 100, ambient: 0, ui: 75 },
      soundInBackground: true,
      monoSound: true,
      jinglesEnabled: false,
      unitResponses: 'off',
      soundQuality: 'lossless',
      language: 'eng',
      keyboardScrollSpeed: 1.25,
      edgeScrollSpeed: 2.25,
      dragScrollSpeed: 1.75,
      edgeScrollEnabled: false,
      invertDragScroll: true,
      integerScaling: true,
      netNick: 'Ania',
      netCustomRelayUrl: 'ws://localhost:8768',
      debugToolsEnabled: true,
      autoErrorReports: false,
      originalGameVerified: true,
      originalGameLabel: 'Cultures: Northland (PL)',
      originalGameFolder: 'Cultures Northland',
      autosaveMinutes: 15,
      autosaveCount: 3,
    } as const;
    expect(
      parseStoredSettings(JSON.stringify({ ...settings, changedKeyBindings: { pauseToggle: 'KeyO' } })),
    ).toEqual({ ...settings, keyBindings: { ...DEFAULT_KEY_BINDINGS, pauseToggle: 'KeyO' } });
  });

  it('falls back per field, not per blob', () => {
    const parsed = parseStoredSettings(
      '{"language":"eng","uiScaleFactor":"big","displayMode":"borderless","renderScale":"max","backingDensity":"half","postFxEnabled":1,"fpsLimit":45}',
    );
    expect(parsed.language).toBe('eng');
    expect(parsed.uiScaleFactor).toBe(defaultSettings().uiScaleFactor);
    expect(parsed.displayMode).toBe('window');
    expect(parsed.renderScale).toBe(defaultSettings().renderScale);
    expect(parsed.backingDensity).toBe('auto');
    expect(parsed.postFxEnabled).toBe(defaultSettings().postFxEnabled);
    expect(parsed.fpsLimit).toBe(defaultSettings().fpsLimit);
    expect(parsed.soundEnabled).toBe(defaultSettings().soundEnabled);
    expect(parsed.keyBindings).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('keeps the display-rate frame cap and defaults a missing one', () => {
    expect(parseStoredSettings('{"fpsLimit":null}').fpsLimit).toBeNull();
    expect(parseStoredSettings('{"fpsLimit":30}').fpsLimit).toBe(30);
    expect(parseStoredSettings('{}').fpsLimit).toBe(60);
  });

  it('plays sound in the background by default only outside a browser tab', () => {
    expect(defaultSettings().soundInBackground).toBe(false);
    vi.stubGlobal('window', {});
    expect(parseStoredSettings('{}').soundInBackground).toBe(false);
    vi.stubGlobal('window', { desktop: { fullscreen: {} } });
    expect(parseStoredSettings('{}').soundInBackground).toBe(true);
    expect(parseStoredSettings('{"soundInBackground":false}').soundInBackground).toBe(false);
  });

  it('loads lossless sounds by default only on the desktop and keeps a stored choice', () => {
    vi.stubGlobal('window', {});
    expect(defaultSettings().soundQuality).toBe('compact');
    expect(parseStoredSettings('{"soundQuality":"flac"}').soundQuality).toBe('compact');
    vi.stubGlobal('window', { desktop: { fullscreen: {} } });
    expect(defaultSettings().soundQuality).toBe('lossless');
    expect(parseStoredSettings('{"soundQuality":"compact"}').soundQuality).toBe('compact');
  });

  it('rings the jingles and answers every call unless stored choices say otherwise', () => {
    expect(parseStoredSettings('{}')).toMatchObject({ jinglesEnabled: true, unitResponses: 'all' });
    expect(parseStoredSettings('{"jinglesEnabled":false,"unitResponses":"selection"}')).toMatchObject({
      jinglesEnabled: false,
      unitResponses: 'selection',
    });
    expect(parseStoredSettings('{"jinglesEnabled":0,"unitResponses":"some"}')).toMatchObject({
      jinglesEnabled: true,
      unitResponses: 'all',
    });
  });

  it.each([false, true])('defaults diagnostics to development mode (%s), keeping stored choices', (dev) => {
    vi.stubEnv('DEV', dev);
    try {
      for (const raw of [null, '{}', '{"fpsCounter":"on","debugToolsEnabled":"on"}']) {
        expect(parseStoredSettings(raw)).toMatchObject({ fpsCounter: dev, debugToolsEnabled: dev });
      }
      for (const enabled of [false, true]) {
        const settings = { fpsCounter: enabled, debugToolsEnabled: enabled };
        expect(parseStoredSettings(JSON.stringify(settings))).toMatchObject(settings);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('defaults, validates, and clamps persisted camera input settings', () => {
    const defaults = defaultSettings();
    expect(defaults).toMatchObject({
      keyboardScrollSpeed: 1.5,
      edgeScrollSpeed: 1.5,
      dragScrollSpeed: 1.5,
      edgeScrollEnabled: true,
      invertDragScroll: true,
    });
    expect(parseStoredSettings('{}')).toMatchObject({
      keyboardScrollSpeed: defaults.keyboardScrollSpeed,
      edgeScrollSpeed: defaults.edgeScrollSpeed,
      dragScrollSpeed: defaults.dragScrollSpeed,
      edgeScrollEnabled: true,
      invertDragScroll: true,
    });
    expect(
      parseStoredSettings(
        '{"keyboardScrollSpeed":1.25,"edgeScrollSpeed":2.25,"dragScrollSpeed":1.75,"edgeScrollEnabled":false,"invertDragScroll":true}',
      ),
    ).toMatchObject({
      keyboardScrollSpeed: 1.25,
      edgeScrollSpeed: 2.25,
      dragScrollSpeed: 1.75,
      edgeScrollEnabled: false,
      invertDragScroll: true,
    });
    expect(parseStoredSettings('{"keyboardScrollSpeed":99}').keyboardScrollSpeed).toBe(SCROLL_SPEED_MAX);
    expect(parseStoredSettings('{"edgeScrollSpeed":0}').edgeScrollSpeed).toBe(SCROLL_SPEED_MIN);
    expect(
      parseStoredSettings(
        '{"scrollSpeed":3,"keyboardScrollSpeed":"fast","edgeScrollEnabled":"off","invertDragScroll":"yes"}',
      ),
    ).toMatchObject({
      keyboardScrollSpeed: defaults.keyboardScrollSpeed,
      edgeScrollSpeed: defaults.edgeScrollSpeed,
      dragScrollSpeed: defaults.dragScrollSpeed,
      edgeScrollEnabled: defaults.edgeScrollEnabled,
      invertDragScroll: defaults.invertDragScroll,
    });
  });

  it('clamps an out-of-range stored factor instead of dropping it', () => {
    expect(parseStoredSettings('{"uiScaleFactor":9}').uiScaleFactor).toBe(UI_SCALE_FACTOR_MAX);
    expect(parseStoredSettings('{"uiScaleFactor":0.1}').uiScaleFactor).toBe(UI_SCALE_FACTOR_MIN);
    expect(parseStoredSettings('{"renderScale":9}').renderScale).toBe(RENDER_SCALE_MAX);
    expect(parseStoredSettings('{"renderScale":0.1}').renderScale).toBe(RENDER_SCALE_MIN);
  });

  it('starts a player with nothing stored in the browser language, English when it ships no catalog', () => {
    vi.stubGlobal('navigator', { languages: ['en-GB'] });
    expect(parseStoredSettings(null).language).toBe('eng');
    vi.stubGlobal('navigator', { languages: ['ja-JP'] });
    expect(parseStoredSettings(null).language).toBe('eng');
    vi.stubGlobal('navigator', { languages: ['zh-CN'] });
    expect(parseStoredSettings(null).language).toBe('chs');
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

  it('keeps only the bindings a player changed, so an untouched key follows a new default', () => {
    const blob = storedBlob({
      ...defaultSettings(),
      keyBindings: { ...DEFAULT_KEY_BINDINGS, pauseToggle: 'KeyO', attackMove: null },
    });
    expect(blob.changedKeyBindings).toEqual({ pauseToggle: 'KeyO', attackMove: null });
    expect('keyBindings' in blob).toBe(false);
    // A full map an earlier build stored is not this format, and holds nobody's choices back.
    expect(parseStoredSettings('{"keyBindings":{"hudToggle":"KeyH"}}').keyBindings).toEqual(
      DEFAULT_KEY_BINDINGS,
    );
  });

  it('stores the sound quality and reads it back', () => {
    const blob = storedBlob({ ...defaultSettings(), soundQuality: 'lossless' });
    expect(blob.soundQuality).toBe('lossless');
    expect(parseStoredSettings(JSON.stringify(blob)).soundQuality).toBe('lossless');
  });

  it('clamps stored volumes into the slider range, whole steps, and defaults deformed ones', () => {
    const volumes = parseStoredSettings(
      '{"volumes":{"master":140,"music":-5,"voice":"loud","world":42.6}}',
    ).volumes;
    expect(volumes).toEqual({ ...DEFAULT_VOLUMES, master: 100, music: 0, world: 43 });
  });

  it('patches one live setting without overwriting the rest of the stored choices', () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => JSON.stringify({ renderScale: 1.5, volumes: { ...DEFAULT_VOLUMES, music: 80 } }),
        setItem,
      },
    });

    const next = patchStoredSettings({ volumes: { ...DEFAULT_VOLUMES, music: 25 } });

    expect(next.renderScale).toBe(1.5);
    expect(next.volumes.music).toBe(25);
    expect(JSON.parse(String(setItem.mock.calls[0]?.[1]))).toMatchObject({
      renderScale: 1.5,
      volumes: { music: 25 },
    });
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

describe('updateSettings', () => {
  const VIKINGS = 1;
  const TRIBE_NAMES: Readonly<Record<string, string>> = { ger: 'Nordmänner', rus: 'Викинги' };

  /** Answers each language's strings only when the test releases it, so installs can overlap. */
  function heldStrings(): (lang: string) => void {
    const pending = new Map<string, () => void>();
    vi.stubGlobal('fetch', (url: string) => {
      const lang = /strings\/(\w+)\.json$/.exec(url)?.[1] ?? '';
      const body = { tribes: { [VIKINGS]: TRIBE_NAMES[lang] } };
      return new Promise<Response>((resolve) =>
        pending.set(lang, () => resolve(new Response(JSON.stringify(body)))),
      );
    });
    return (lang) => pending.get(lang)?.();
  }

  // Drop the fresh graph from the shared registry too, or the next test file would import it.
  afterEach(() => vi.resetModules());

  /** The settings session and catalog from a fresh module graph, so neither the loaded string tables nor
   *  the language change reach another test (the app tests share one registry). */
  async function freshSettings() {
    vi.stubGlobal('window', {
      location: { href: 'http://localhost/' },
      history: { state: null, replaceState: () => undefined },
      localStorage: { getItem: () => null, setItem: () => undefined },
    });
    vi.resetModules();
    const settings = await import('../../../../src/entries/main-menu/settings/state.js');
    const { tribeName } = await import('../../../../src/i18n/index.js');
    const heard: string[] = [];
    const scope = new AbortController();
    settings.onSettingsChange(() => heard.push(tribeName(VIKINGS)), scope.signal);
    return { update: settings.updateSettings, heard, stop: () => scope.abort() };
  }

  it("installs a new language's original tribe names before its listeners re-render", async () => {
    const release = heldStrings();
    const { update, heard, stop } = await freshSettings();
    const updating = update({ language: 'ger' });
    release('ger');
    await updating;
    stop();
    expect(heard).toEqual([TRIBE_NAMES.ger]);
  });

  it('leaves the notice to a later language change that starts during the install', async () => {
    const release = heldStrings();
    const { update, heard, stop } = await freshSettings();
    const first = update({ language: 'ger' });
    const second = update({ language: 'rus' });
    release('ger');
    await first;
    expect(heard).toEqual([]);
    release('rus');
    await second;
    stop();
    expect(heard).toEqual([TRIBE_NAMES.rus]);
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
