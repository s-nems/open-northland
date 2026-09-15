import type { TextureSource } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `loadTextureIfPresent` is the optional-texture half of the degrade policy in `content/net.ts`. Its
 * callers - the player-colour LUT, the GUI and font palette LUTs, the goods palette, the panel bitmap
 * fills - read `undefined` as the only failure signal and have no `catch` of their own, so a rejection
 * here escapes far past the texture: a broken `player-lut.png` fails all of `loadHumanSheet` rather
 * than just dropping per-player recolouring.
 */

type LoadAtlasSource = typeof import('@open-northland/render').loadAtlasSource;

/** Stub only `loadAtlasSource`; going through the real module would pull the whole Pixi graph in for a
 *  function under test that needs one export. Hoisted so `vi.mock` can close over the control. */
const source = vi.hoisted(() => {
  const serve: LoadAtlasSource = (url) => Promise.resolve({ label: url } as TextureSource);
  return { load: serve, serve };
});

vi.mock('@open-northland/render', () => ({
  loadAtlasSource: ((url, scaleMode, alpha) => source.load(url, scaleMode, alpha)) as LoadAtlasSource,
}));

// Test files share one module registry, so the fake above only reaches `content/net.ts` when that
// module is imported into a registry cleared of the real render package. The subject's `diag` has
// to come from that same fresh graph; the suite's setup file silenced only the original instance.
vi.resetModules();
const { loadTextureIfPresent } = await import('../src/content/net.js');
const { diag } = await import('../src/diag/log.js');
diag.setConsoleLevel('silent');

const LUT_URL = '/bobs/player-lut.png';

/** Entries the call under test appended - the ring is app-wide and shared across the suite. */
let ringBefore = 0;
function warnings(): readonly { message: string; channel: string; data?: unknown }[] {
  return diag
    .entries()
    .slice(ringBefore)
    .filter((e) => e.level === 'warn')
    .map((e) => ({ message: e.message, channel: e.channel, data: e.data }));
}

function serveHead(status: number): void {
  vi.stubGlobal('fetch', (() => Promise.resolve(new Response(null, { status }))) as typeof fetch);
}

beforeEach(() => {
  ringBefore = diag.entries().length;
});

afterEach(() => {
  vi.unstubAllGlobals();
  source.load = source.serve;
});

describe('loading an optional texture', () => {
  it('returns the texture the server serves', async () => {
    serveHead(200);

    await expect(loadTextureIfPresent(LUT_URL)).resolves.toMatchObject({ label: LUT_URL });
    expect(warnings()).toEqual([]);
  });

  it('degrades silently when the pipeline has not produced it', async () => {
    serveHead(404);

    await expect(loadTextureIfPresent(LUT_URL)).resolves.toBeUndefined();
    expect(warnings()).toEqual([]);
  });

  it('degrades with a warning when the request itself fails', async () => {
    const failure = new Error('transport failed');
    vi.stubGlobal('fetch', (() => Promise.reject(failure)) as typeof fetch);

    await expect(loadTextureIfPresent(LUT_URL)).resolves.toBeUndefined();
    expect(warnings()).toEqual([
      { message: expect.stringContaining(LUT_URL), channel: 'content', data: expect.anything() },
    ]);
  });

  it('degrades with a warning when the served image cannot be decoded', async () => {
    serveHead(200);
    source.load = () => Promise.reject(new Error('corrupt PNG'));

    await expect(loadTextureIfPresent(LUT_URL)).resolves.toBeUndefined();
    expect(warnings()).toEqual([
      { message: expect.stringContaining(LUT_URL), channel: 'content', data: expect.anything() },
    ]);
  });
});
