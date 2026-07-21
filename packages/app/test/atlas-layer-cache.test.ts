import type { TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The house and building-family atlases are loaded by both the world sprite sheet
 * (`content/sprite-sheet/human-sheet.ts`, with shadow twins) and the details panel's building previews
 * (`hud/details-panel/assets.ts`, without), so `content/ir.ts` caches the atlas BODY per stem and composes
 * the shadow on top — keying on `(stem, shadowStem)` would dedupe neither call site.
 *
 * Pixi's `Assets` already dedupes the `<stem>.png` upload by URL. What the cache removes is the manifest
 * fetch + frame indexing and, for a `build: true` atlas, a second CPU readback of the `<stem>.build.png`
 * time sheet — that one goes through `fetchImageData`, which nothing else caches.
 */

/**
 * `loadAtlasSource` uploads through Pixi's `Assets`, which needs a GPU; stub just that export (the rest of
 * the render module stays real) and record the `(url, alpha)` it is asked for. Hoisted so `vi.mock` can
 * close over the recorder.
 */
type LoadAtlasSource = typeof import('@open-northland/render').loadAtlasSource;
type Upload = { url: string; alpha: Parameters<LoadAtlasSource>[2] };

const uploads = vi.hoisted(() => [] as Upload[]);

vi.mock('@open-northland/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-northland/render')>();
  const loadAtlasSource: LoadAtlasSource = (url, _scaleMode, alpha) => {
    uploads.push({ url, alpha });
    return Promise.resolve({ label: url } as unknown as TextureSource);
  };
  return { ...actual, loadAtlasSource };
});

/**
 * `content/ir.ts` pulls in the whole Pixi graph, and under a full-suite run its cold Vite transform costs
 * seconds that are charged to whichever test triggers it — well past the 5 s default. (Run this file
 * alone, against a warm cache, and the whole suite finishes in under 2 s.)
 */
const IR_LOADER_TIMEOUT_MS = 30_000;

const BODY_STEM = 'ls_houses_viking.house01';
const SHADOW_STEM = 'ls_houses_viking.house01.shadow';
/** A palette-indexed stem, which must load straight-alpha (see `isIndexedStem`). */
const INDEXED_STEM = 'cr_hum_body_00.indexed';

/** The smallest manifest `atlasFromManifest` accepts: one frame, no build-time sheet. */
const MANIFEST = {
  width: 8,
  height: 8,
  frames: [{ bobId: 1, rect: { x: 0, y: 0, width: 4, height: 4 }, offsetX: 0, offsetY: 0 }],
} as const;

/** The house atlases' shape: a sibling `<stem>.build.png` the loader reads back CPU-side. */
const BUILD_MANIFEST = { ...MANIFEST, build: true } as const;

/** A `fetch` stub recording every requested URL and serving `manifests` by stem; anything else 404s. */
function countingFetch(manifests: Readonly<Record<string, object>>): {
  impl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const impl: typeof fetch = (input) => {
    const url = String(input);
    urls.push(url);
    const stem = Object.keys(manifests).find((s) => url === `/bobs/${s}.atlas.json`);
    return Promise.resolve(
      stem === undefined
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(manifests[stem])),
    );
  };
  return { impl, urls };
}

/** A fresh module graph, so the module-level layer cache starts empty. */
async function freshLoader() {
  vi.resetModules();
  uploads.length = 0;
  return await import('../src/content/ir.js');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the decoded atlas layer cache', { timeout: IR_LOADER_TIMEOUT_MS }, () => {
  it('fetches, decodes and indexes a stem once however many callers ask for it', async () => {
    const { impl, urls } = countingFetch({ [BODY_STEM]: MANIFEST });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    const [first, second] = await Promise.all([loadLayer(BODY_STEM), loadLayer(BODY_STEM)]);

    expect(urls).toEqual([`/bobs/${BODY_STEM}.atlas.json`]);
    expect(uploads).toEqual([{ url: `/bobs/${BODY_STEM}.png`, alpha: 'premultiplied' }]);
    expect(second).toBe(first); // one shared instance, not two decodes of the same bytes
  });

  it('shares the body when the same stem is asked for with and without its shadow twin', async () => {
    const { impl, urls } = countingFetch({ [BODY_STEM]: MANIFEST, [SHADOW_STEM]: MANIFEST });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    // The two real call sites, in their real shapes: the details panel wants the bare body, the world
    // sprite sheet the same body plus its cast-shadow twin.
    const [bare, shadowed] = await Promise.all([loadLayer(BODY_STEM), loadLayer(BODY_STEM, SHADOW_STEM)]);

    expect(urls.filter((u) => u === `/bobs/${BODY_STEM}.atlas.json`)).toHaveLength(1);
    expect(uploads).toHaveLength(2); // the body and the shadow, one upload each
    expect(bare.source).toBe(shadowed.source);
    expect(bare.atlas).toBe(shadowed.atlas);
    // Composing the shadow must not leak back onto the bare body the other caller holds.
    expect(bare.shadow).toBeUndefined();
    expect(shadowed.shadow?.source).toMatchObject({ label: `/bobs/${SHADOW_STEM}.png` });
  });

  it('reads a build-time sheet back once for two callers of the same house atlas', async () => {
    const { impl, urls } = countingFetch({ [BODY_STEM]: BUILD_MANIFEST });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    await Promise.all([loadLayer(BODY_STEM), loadLayer(BODY_STEM, SHADOW_STEM)]);

    // The readback this cache exists to remove: `<stem>.build.png` is multi-megapixel and Pixi's `Assets`
    // never sees it, so an uncached second caller paid the whole fetch + decode again.
    expect(urls.filter((u) => u === `/bobs/${BODY_STEM}.build.png`)).toHaveLength(1);
  });

  it('loads a palette-indexed stem straight-alpha', async () => {
    const { impl } = countingFetch({ [INDEXED_STEM]: MANIFEST });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    await loadLayer(INDEXED_STEM);

    expect(uploads).toEqual([{ url: `/bobs/${INDEXED_STEM}.png`, alpha: 'straight' }]);
  });

  it('degrades to a shadow-less layer when the shadow atlas is absent', async () => {
    const { impl } = countingFetch({ [BODY_STEM]: MANIFEST }); // shadow stem 404s
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    const layer = await loadLayer(BODY_STEM, SHADOW_STEM);

    expect(layer.shadow).toBeUndefined();
    expect(layer.atlas.frames.size).toBe(1);
  });

  it('reports the missing body even when the shadow fails first, in some other way', async () => {
    // The shadow fails IMMEDIATELY at the network level while the body's 404 arrives a tick later. This
    // is the one case that pins the ordering: the body is awaited FIRST, so its `MissingAtlasError` is
    // what the caller sees. Racing the two would surface the shadow's error instead, and the callers
    // that degrade on a missing atlas (`hud/details-panel/assets.ts`, `content/objects.ts`) rethrow
    // anything else — a partial `content/` would hard-fail rather than fall back.
    vi.stubGlobal('fetch', ((input: RequestInfo | URL) =>
      String(input) === `/bobs/${SHADOW_STEM}.atlas.json`
        ? Promise.reject(new Error('shadow transport failed'))
        : new Promise((resolve) => {
            setTimeout(() => resolve(new Response(null, { status: 404 })), 5);
          })) as typeof fetch);
    const { loadLayer, MissingAtlasError } = await freshLoader();

    const failed = loadLayer(BODY_STEM, SHADOW_STEM);

    await expect(failed).rejects.toThrow(MissingAtlasError);
    await expect(failed).rejects.toThrow(BODY_STEM); // names the stem the caller asked for
  });

  it('memoizes only success, so a transient failure does not pin the stem', async () => {
    let manifests: Record<string, object> = {};
    vi.stubGlobal('fetch', ((input: RequestInfo | URL) =>
      countingFetch(manifests).impl(input)) as typeof fetch);
    const { loadLayer, MissingAtlasError } = await freshLoader();

    await expect(loadLayer(BODY_STEM)).rejects.toThrow(MissingAtlasError);

    manifests = { [BODY_STEM]: MANIFEST };
    await expect(loadLayer(BODY_STEM)).resolves.toMatchObject({ source: expect.anything() });
  });
});
