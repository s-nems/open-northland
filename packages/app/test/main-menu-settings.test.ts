import { describe, expect, it } from 'vitest';
import {
  carriedSettingParams,
  DEFAULT_SETTINGS,
  parseStoredSettings,
  UI_SCALE_MAX,
} from '../src/entries/main-menu/settings-state.js';

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
      uiScale: 1.75,
      soundEnabled: false,
      language: 'eng',
    } as const;
    expect(parseStoredSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it('falls back per field, not per blob', () => {
    const parsed = parseStoredSettings('{"language":"eng","uiScale":"big","displayMode":"borderless"}');
    expect(parsed.language).toBe('eng');
    expect(parsed.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
    expect(parsed.displayMode).toBe('window');
    expect(parsed.soundEnabled).toBe(DEFAULT_SETTINGS.soundEnabled);
  });

  it('clamps an out-of-range stored scale instead of dropping it', () => {
    expect(parseStoredSettings('{"uiScale":9}').uiScale).toBe(UI_SCALE_MAX);
    expect(parseStoredSettings('{"uiScale":0.2}').uiScale).toBe(1);
  });
});

describe('carriedSettingParams', () => {
  it('elides every param at defaults, so a clean URL stays clean', () => {
    expect(carriedSettingParams(DEFAULT_SETTINGS).every((row) => row.value === null)).toBe(true);
  });

  it('projects non-default values onto lang/uiscale/sound', () => {
    const rows = carriedSettingParams({
      ...DEFAULT_SETTINGS,
      language: 'eng',
      uiScale: 1.75,
      soundEnabled: false,
    });
    expect(rows).toEqual([
      { key: 'language', param: 'lang', value: 'eng' },
      { key: 'uiScale', param: 'uiscale', value: '1.75' },
      { key: 'soundEnabled', param: 'sound', value: 'off' },
    ]);
  });
});
