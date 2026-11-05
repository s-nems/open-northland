// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as hardware from '../../../src/view/graphics/hardware.js';
import { detectGraphicsTier } from '../../../src/view/graphics/tier.js';

const database = resolve(dirname(fileURLToPath(import.meta.resolve('@pmndrs/detect-gpu'))), 'benchmarks');
const databaseURL = '/gpu-benchmarks/test-version';

function display(width = 1920, height = 1080, dpr = 1): void {
  vi.stubGlobal('window', {
    navigator,
    innerWidth: width,
    innerHeight: height,
    screen: { width, height },
    devicePixelRatio: dpr,
  });
}

const fetchDatabase = vi.fn(async (url: string) => {
  const filename = url.slice(databaseURL.length + 1);
  if (!url.startsWith(`${databaseURL}/`) || !/^[dm]-[a-z-]+\.json$/.test(filename)) {
    throw new Error(`Unexpected benchmark request: ${url}`);
  }
  return new Response(readFileSync(resolve(database, filename)), { status: 200 });
});

beforeEach(() => {
  display();
  fetchDatabase.mockClear();
  vi.stubGlobal('__GPU_BENCHMARKS_URL__', databaseURL);
  vi.stubGlobal('fetch', fetchDatabase);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bundled GPU benchmark detection', () => {
  it.each([
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4090, D3D11)', 3],
    ['NVIDIA GeForce GTX 1650', 3],
    ['AMD Radeon RX 9070 XT', 3],
    ['Intel UHD Graphics 620', 1],
    ['Intel HD Graphics 4000', 1],
    // A model-less Ryzen APU, which recommendGraphics caps by its device id.
    ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x0000164E) Direct3D11 vs_5_0 ps_5_0, D3D11)', 3],
  ] as const)('classifies %s using the installed library and its database', async (renderer, tier) => {
    vi.spyOn(hardware, 'detectedWebglRenderer').mockReturnValue(renderer);
    const detection = await detectGraphicsTier();
    expect(detection.result).toMatchObject({ tier, type: 'BENCHMARK' });
    expect(detection.result.fps).toBeGreaterThan(0);
    expect(fetchDatabase).toHaveBeenCalled();
    expect(detection.physicalPixels).toBe(1920 * 1080);
  });

  it('shares a lookup for the same display and leaves resolution handling to the library', async () => {
    vi.spyOn(hardware, 'detectedWebglRenderer').mockReturnValue('NVIDIA GeForce RTX 4090');
    display(1920, 1080, 2);
    const first = detectGraphicsTier();
    expect(detectGraphicsTier()).toBe(first);
    expect(await first).toMatchObject({ physicalPixels: 3840 * 2160, result: { tier: 3 } });
    window.innerWidth = 2560;
    const changed = detectGraphicsTier();
    expect(changed).not.toBe(first);
    expect((await changed).physicalPixels).toBe(2560 * 1080 * 4);
  });

  it('selects the library sample nearest the display pixel count, including DPR', async () => {
    vi.spyOn(hardware, 'detectedWebglRenderer').mockReturnValue('Intel Iris Graphics 6100');
    expect((await detectGraphicsTier()).result).toMatchObject({ tier: 2, fps: 59 });
    display(1280, 800, 2);
    expect((await detectGraphicsTier()).result).toMatchObject({ tier: 1, fps: 20 });
  });

  it('handles masked, unknown, blocked and unavailable adapters without failing boot', async () => {
    const renderer = vi.spyOn(hardware, 'detectedWebglRenderer');
    for (const [name, type] of [
      ['WebKit WebGL', 'FALLBACK'],
      ['NVIDIA GeForce RTX 9999', 'FALLBACK'],
      ['SwiftShader', 'BLOCKLISTED'],
      [null, 'WEBGL_UNSUPPORTED'],
    ] as const) {
      display();
      renderer.mockReturnValue(name);
      expect((await detectGraphicsTier()).result.type).toBe(type);
    }
  });

  it('allows an explicit retry when database loading fails', async () => {
    vi.spyOn(hardware, 'detectedWebglRenderer').mockReturnValue('NVIDIA GeForce RTX 4090');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));
    expect((await detectGraphicsTier()).result.type).toBe('BENCHMARK_FETCH_FAILED');
    vi.stubGlobal('fetch', fetchDatabase);
    expect((await detectGraphicsTier()).result).toMatchObject({ type: 'BENCHMARK', tier: 3 });
  });

  it('bounds a stalled lookup and cannot change its answer when data arrives late', async () => {
    vi.spyOn(hardware, 'detectedWebglRenderer').mockReturnValue('NVIDIA GeForce RTX 4090');
    let finish: (response: Response) => void = () => undefined;
    const stalled = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', stalled);
    vi.useFakeTimers();
    const result = detectGraphicsTier();
    await vi.advanceTimersByTimeAsync(3000);
    expect((await result).result.type).toBe('BENCHMARK_FETCH_FAILED');
    finish(await fetchDatabase(`${databaseURL}/d-nvidia.json`));
    expect((await result).result.type).toBe('BENCHMARK_FETCH_FAILED');
  });
});
