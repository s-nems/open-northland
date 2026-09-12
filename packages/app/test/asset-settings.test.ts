import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adoptSettings,
  adoptStoredSettings,
  menuSettings,
  updateSettings,
} from '../src/entries/main-menu/settings-state.js';
import { assetSetFor } from '../src/view/asset-settings.js';
import { mapZoomParam } from '../src/view/camera/map-zoom.js';
import { defaultSettings, parseStoredSettings } from '../src/view/settings-store.js';

afterEach(() => vi.unstubAllGlobals());

describe('asset settings', () => {
  it('defaults new, old, and invalid settings to own assets', () => {
    for (const raw of [null, '{}', '{"assets":"unknown"}']) {
      expect(parseStoredSettings(raw).assets).toBe('own');
    }
    expect(parseStoredSettings('{"assets":"original"}').assets).toBe('original');
  });

  it('uses stored assets for direct entries, with explicit URL overrides', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{"assets":"original"}' } });
    expect(assetSetFor(new URLSearchParams())).toBe('original');
    expect(mapZoomParam(new URLSearchParams())).toBe(1);
    expect(assetSetFor(new URLSearchParams('assets=own'))).toBe('own');
    expect(mapZoomParam(new URLSearchParams('assets=own'))).toBe(1);
    expect(assetSetFor(new URLSearchParams('assets=original'), 'own')).toBe('original');
    expect(assetSetFor(new URLSearchParams('assets=invalid'), 'own')).toBe('own');
  });

  it('adopts the saved choice in the menu without overwriting explicit links', () => {
    const stored = { ...defaultSettings(), assets: 'original' } as const;
    const params = new URLSearchParams();
    expect(adoptSettings(stored, params).session.assets).toBe('original');
    expect(params.get('assets')).toBe('original');
    expect(adoptSettings(stored, new URLSearchParams('assets=own')).session.assets).toBe('own');
  });

  it('saves edits, clears overrides on reset, and rereads changes made in game', () => {
    let raw = '{"assets":"original"}';
    let href = 'http://localhost/?assets=own';
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => raw,
        setItem: (_key: string, value: string) => {
          raw = value;
        },
      },
      location: {
        get href() {
          return href;
        },
      },
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, url: URL) => {
          href = url.toString();
        },
      },
    });
    adoptStoredSettings(new URLSearchParams('assets=own'));
    updateSettings({ soundEnabled: false });
    expect(parseStoredSettings(raw).assets).toBe('original');
    updateSettings({ assets: 'original' });
    expect(new URL(href).searchParams.get('assets')).toBe('original');
    updateSettings({ assets: 'own' });
    expect(parseStoredSettings(raw).assets).toBe('own');
    expect(new URL(href).searchParams.has('assets')).toBe(false);
    raw = '{"assets":"original"}';
    adoptStoredSettings(new URLSearchParams());
    expect(menuSettings().assets).toBe('original');
  });
});
