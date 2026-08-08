import { describe, expect, it } from 'vitest';
import { adoptSettings, carriedSettingParams } from '../src/entries/main-menu/settings-state.js';
import { UI_SCALE_FACTOR_MAX, UI_SCALE_FACTOR_MIN } from '../src/hud/ui-scale.js';
import { DEFAULT_SETTINGS, parseStoredSettings } from '../src/view/settings-store.js';

describe('parseStoredSettings', () => {
  it('falls back to defaults for an empty store, garbage, or a non-object', () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a full settings object', () => {
    const settings = {
      displayMode: 'fullscreen',
      uiScaleFactor: 1.25,
      soundEnabled: false,
      language: 'eng',
    } as const;
    expect(parseStoredSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it('falls back per field, not per blob', () => {
    const parsed = parseStoredSettings('{"language":"eng","uiScaleFactor":"big","displayMode":"borderless"}');
    expect(parsed.language).toBe('eng');
    expect(parsed.uiScaleFactor).toBe(DEFAULT_SETTINGS.uiScaleFactor);
    expect(parsed.displayMode).toBe('window');
    expect(parsed.soundEnabled).toBe(DEFAULT_SETTINGS.soundEnabled);
  });

  it('clamps an out-of-range stored factor instead of dropping it', () => {
    expect(parseStoredSettings('{"uiScaleFactor":9}').uiScaleFactor).toBe(UI_SCALE_FACTOR_MAX);
    expect(parseStoredSettings('{"uiScaleFactor":0.1}').uiScaleFactor).toBe(UI_SCALE_FACTOR_MIN);
  });

  it('ignores the pre-relative absolute `uiScale` field', () => {
    expect(parseStoredSettings('{"uiScale":1.75}').uiScaleFactor).toBe(DEFAULT_SETTINGS.uiScaleFactor);
  });
});

describe('adoptSettings', () => {
  const stored = { ...DEFAULT_SETTINGS, language: 'eng', soundEnabled: false } as const;

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

  it('never puts the HUD scale factor into the URL', () => {
    const params = new URLSearchParams('');
    adoptSettings({ ...DEFAULT_SETTINGS, uiScaleFactor: 1.25 }, params);
    expect([...params.keys()]).toEqual([]);
  });
});

describe('carriedSettingParams', () => {
  it('elides every param at defaults, so a clean URL stays clean', () => {
    expect(carriedSettingParams(DEFAULT_SETTINGS).every((row) => row.value === null)).toBe(true);
  });

  it('projects non-default values onto lang/sound and keeps the scale factor out', () => {
    const rows = carriedSettingParams({
      ...DEFAULT_SETTINGS,
      language: 'eng',
      uiScaleFactor: 1.25,
      soundEnabled: false,
    });
    expect(rows).toEqual([
      { key: 'language', param: 'lang', value: 'eng' },
      { key: 'soundEnabled', param: 'sound', value: 'off' },
    ]);
  });
});
