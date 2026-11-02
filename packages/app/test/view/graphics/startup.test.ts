import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeGraphicsSettings, recommendedSettings } from '../../../src/view/graphics/startup.js';
import * as graphicsTier from '../../../src/view/graphics/tier.js';
import {
  defaultSettings,
  initializeStoredSettings,
  patchStoredSettings,
  readStoredSettings,
} from '../../../src/view/settings/store.js';

const QUALITY_TIER = 3;
const PERFORMANCE_TIER = 1;

function storage(raw: string | null = null) {
  let current = raw;
  return {
    getItem: vi.fn(() => current),
    setItem: vi.fn((_key: string, value: string) => {
      current = value;
    }),
    raw: () => current,
  };
}

function detection(tier: number): graphicsTier.GraphicsDetection {
  return {
    renderer: `Test GPU tier ${tier}`,
    physicalPixels: 1920 * 1080,
    result: { tier, type: 'BENCHMARK' },
  };
}

function boot(tier: number, localStorage: ReturnType<typeof storage>) {
  vi.restoreAllMocks();
  vi.stubGlobal('navigator', { languages: ['en-US'] });
  vi.stubGlobal('window', { localStorage });
  return vi.spyOn(graphicsTier, 'detectGraphicsTier').mockResolvedValue(detection(tier));
}

function holdDetection(probe: ReturnType<typeof boot>, tier: number) {
  let release = (): void => undefined;
  const pending = new Promise<graphicsTier.GraphicsDetection>((resolve) => {
    release = () => resolve(detection(tier));
  });
  probe.mockReturnValue(pending);
  return () => release();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('first-start graphics settings', () => {
  it('persists the hardware defaults once before later settings readers', async () => {
    const saved = storage();
    const probe = boot(QUALITY_TIER, saved);
    await initializeGraphicsSettings();
    await initializeGraphicsSettings();

    expect(saved.setItem).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({
      enhancedSampling: true,
      pixelArtScaler: 'xbr',
      softShadows: true,
      enhancedWater: true,
      environmentMotion: true,
      groundedBuildings: true,
      buildingDamage: true,
      dayNight: true,
      weather: true,
      postFxEnabled: true,
    });
    expect(saved.raw()).not.toBeNull();
  });

  it.each(['{}', 'not json', 'null', '42', '{"weather":false,"pixelArtScaler":"xbrz"}'])(
    'leaves an existing blob untouched without probing the GPU: %s',
    async (raw) => {
      const saved = storage(raw);
      const probe = boot(PERFORMANCE_TIER, saved);
      await initializeGraphicsSettings();

      expect(saved.raw()).toBe(raw);
      expect(saved.setItem).not.toHaveBeenCalled();
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it('never recomputes first-start defaults after a player changes a setting', async () => {
    const saved = storage();
    boot(PERFORMANCE_TIER, saved);
    const factory = vi.fn(defaultSettings);
    await initializeStoredSettings(factory);
    patchStoredSettings({ weather: false, pixelArtScaler: 'superxbr' });
    await initializeStoredSettings(factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({ weather: false, pixelArtScaler: 'superxbr' });
  });

  it('keeps document defaults without writing when a storage read is denied', async () => {
    const saved = storage('{"weather":true,"pixelArtScaler":"xbrz"}');
    saved.getItem.mockImplementation(() => {
      throw new Error('read denied');
    });
    const probe = boot(PERFORMANCE_TIER, saved);
    await initializeGraphicsSettings();
    await initializeGraphicsSettings();

    expect(saved.setItem).not.toHaveBeenCalled();
    expect(saved.raw()).toBe('{"weather":true,"pixelArtScaler":"xbrz"}');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({ enhancedSampling: false, weather: false });
  });

  it('retains defaults and sequential player patches when storage writes are denied', async () => {
    const saved = storage();
    saved.setItem.mockImplementation(() => {
      throw new Error('write denied');
    });
    const probe = boot(PERFORMANCE_TIER, saved);
    await initializeGraphicsSettings();
    expect(readStoredSettings()).toMatchObject({ enhancedSampling: false, weather: false });

    patchStoredSettings({ enhancedSampling: true, pixelArtScaler: 'xbrz', weather: true });
    patchStoredSettings({ soundEnabled: false });
    await initializeGraphicsSettings();

    expect(saved.raw()).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({
      enhancedSampling: true,
      pixelArtScaler: 'xbrz',
      weather: true,
      softShadows: false,
      soundEnabled: false,
    });
  });

  it.each([
    { first: QUALITY_TIER, next: PERFORMANCE_TIER, enabled: true, pixelArtScaler: 'superxbr' as const },
    { first: PERFORMANCE_TIER, next: QUALITY_TIER, enabled: false, pixelArtScaler: 'xbrz' as const },
  ])('preserves manual choices on a new document from tier $first to $next', async (scenario) => {
    const saved = storage();
    boot(scenario.first, saved);
    await initializeGraphicsSettings();
    const chosen = patchStoredSettings({
      enhancedSampling: scenario.enabled,
      pixelArtScaler: scenario.pixelArtScaler,
      softShadows: scenario.enabled,
      enhancedWater: scenario.enabled,
      environmentMotion: scenario.enabled,
      groundedBuildings: scenario.enabled,
      buildingDamage: scenario.enabled,
      dayNight: scenario.enabled,
      weather: scenario.enabled,
      postFxEnabled: scenario.enabled,
      renderScale: 1.5,
      fpsLimit: 30,
      soundEnabled: false,
    });
    const previous = saved.raw();
    const writes = saved.setItem.mock.calls.length;

    const probe = boot(scenario.next, saved);
    await initializeGraphicsSettings();

    expect(readStoredSettings()).toEqual(chosen);
    expect(saved.raw()).toBe(previous);
    expect(saved.setItem).toHaveBeenCalledTimes(writes);
    expect(probe).not.toHaveBeenCalled();
  });

  it('uses hardware recommendations again when the player explicitly restores defaults', async () => {
    const saved = storage();
    const probe = boot(PERFORMANCE_TIER, saved);
    await initializeGraphicsSettings();
    patchStoredSettings({ enhancedSampling: true, weather: true, soundEnabled: false, renderScale: 2 });

    const defaults = await recommendedSettings();
    expect(readStoredSettings()).toMatchObject({ enhancedSampling: true, weather: true });
    patchStoredSettings(defaults);

    expect(readStoredSettings()).toEqual(defaults);
    expect(defaults).toMatchObject({
      enhancedSampling: false,
      pixelArtScaler: 'xbr',
      weather: false,
      softShadows: false,
      postFxEnabled: false,
      soundEnabled: true,
      renderScale: 1,
    });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('preserves a persistent player edit made while tier detection is pending', async () => {
    const saved = storage();
    const probe = boot(PERFORMANCE_TIER, saved);
    const release = holdDetection(probe, PERFORMANCE_TIER);
    const initializing = initializeGraphicsSettings();
    expect(saved.setItem).not.toHaveBeenCalled();

    const chosen = patchStoredSettings({ enhancedSampling: true, pixelArtScaler: 'xbrz', weather: true });
    const raw = saved.raw();
    release();
    await initializing;

    expect(readStoredSettings()).toEqual(chosen);
    expect(saved.raw()).toBe(raw);
    expect(saved.setItem).toHaveBeenCalledTimes(1);
  });

  it('preserves volatile player edits made while tier detection is pending', async () => {
    const saved = storage();
    saved.setItem.mockImplementation(() => {
      throw new Error('write denied');
    });
    const probe = boot(PERFORMANCE_TIER, saved);
    const release = holdDetection(probe, PERFORMANCE_TIER);
    const initializing = initializeGraphicsSettings();
    patchStoredSettings({ enhancedSampling: true, pixelArtScaler: 'superxbr', weather: true });
    const chosen = patchStoredSettings({ soundEnabled: false });
    release();
    await initializing;

    expect(readStoredSettings()).toEqual(chosen);
    expect(saved.raw()).toBeNull();
    expect(saved.setItem).toHaveBeenCalledTimes(2);
  });

  it('preserves choices saved by another tab while tier detection is pending', async () => {
    const saved = storage();
    const probe = boot(QUALITY_TIER, saved);
    const release = holdDetection(probe, QUALITY_TIER);
    const initializing = initializeGraphicsSettings();
    const raw = '{"enhancedSampling":false,"pixelArtScaler":"xbrz","weather":false,"renderScale":0.75}';
    saved.setItem('open-northland.settings', raw);
    release();
    await initializing;

    expect(saved.raw()).toBe(raw);
    expect(saved.setItem).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({
      enhancedSampling: false,
      pixelArtScaler: 'xbrz',
      weather: false,
      renderScale: 0.75,
    });
  });

  it('coalesces concurrent first-start initialization into one detection and write', async () => {
    const saved = storage();
    const probe = boot(QUALITY_TIER, saved);
    const release = holdDetection(probe, QUALITY_TIER);
    const first = initializeGraphicsSettings();
    const second = initializeGraphicsSettings();
    expect(second).toBe(first);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(saved.setItem).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);

    expect(saved.setItem).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({ enhancedSampling: true, weather: true });
  });

  it.each(['before', 'after'] as const)(
    'does not write if storage reads are denied %s tier detection',
    async (deniedWhen) => {
      const saved = storage();
      const deny = () =>
        saved.getItem.mockImplementation(() => {
          throw new Error('read denied');
        });
      const probe = boot(PERFORMANCE_TIER, saved);
      const release = holdDetection(probe, PERFORMANCE_TIER);
      if (deniedWhen === 'before') deny();
      const initializing = initializeGraphicsSettings();
      if (deniedWhen === 'before') saved.getItem.mockImplementation(() => null);
      else deny();
      release();
      await initializing;

      expect(saved.setItem).not.toHaveBeenCalled();
      expect(readStoredSettings()).toMatchObject({ enhancedSampling: false, weather: false });
    },
  );
});
