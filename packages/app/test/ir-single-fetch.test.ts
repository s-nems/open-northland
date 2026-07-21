import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The served `content/ir.json` is multi-MB and several domains read lanes out of it, so `content/ir/load.ts`
 * owns ONE memoized fetch + JSON parse per page (`loadIrRaw`) that both views derive from — the graphics
 * `loadIr` and the sim-side `loadRealContent`. This pins that: re-adding a second fetch fails here.
 * Each test re-imports the modules under `vi.resetModules()` so the module-level memo starts fresh.
 */

/**
 * Transform the modules under test once, here, outside any test body: `content/ir/load.ts` pulls in
 * `@open-northland/render` (the whole Pixi graph), and a cold Vite transform of it costs seconds that
 * would otherwise be charged to the first test's timeout. `vi.resetModules()` then only re-instantiates
 * an already-transformed graph.
 */
await Promise.all([import('../src/content/ir/load.js'), import('../src/content/real-content.js')]);

/** Generous: even primed, a cold-cache run pays a real (multi-second) transform for this graph. */
const IR_LOADER_TIMEOUT_MS = 30_000;

/** The smallest document `parseContentSet` accepts — every other lane defaults to empty. */
const MINIMAL_IR = {
  manifest: { version: 1, generatedFrom: { game: 'test' } },
  goods: [],
  jobs: [],
  buildings: [],
};

/** A `fetch` stub recording every requested URL; `body` decides what the one served document is. */
function countingFetch(body: () => Response): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl: typeof fetch = (input) => {
    urls.push(String(input));
    return Promise.resolve(body());
  };
  return { impl, urls };
}

/** Both loaders out of ONE fresh module graph, so they share the same `loadIrRaw` memo. */
async function freshLoaders() {
  vi.resetModules();
  const { loadIr } = await import('../src/content/ir/load.js');
  const { loadRealContent } = await import('../src/content/real-content.js');
  return { loadIr, loadRealContent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the shared ir.json fetch', { timeout: IR_LOADER_TIMEOUT_MS }, () => {
  it('fetches /ir.json once when both the graphics and the sim view load it', async () => {
    const { impl, urls } = countingFetch(() => new Response(JSON.stringify(MINIMAL_IR)));
    vi.stubGlobal('fetch', impl);
    const { loadIr, loadRealContent } = await freshLoaders();

    const [ir, content] = await Promise.all([loadIr(), loadRealContent()]);

    expect(urls).toEqual(['/ir.json']);
    // Each view still hands back its own shape off the one document: the graphics view is the raw
    // lanes cast at the boundary, the sim view the zod-validated `ContentSet` (defaults filled in).
    expect(ir).toMatchObject({ manifest: { version: 1 } });
    expect(ir).not.toHaveProperty('sounds');
    expect(content?.goods).toEqual([]);
    expect(content?.sounds).toEqual({ staticGroups: [], ambient: [], jingles: [] });
  });

  it('memoizes only success, so a transient boot failure does not pin either loader', async () => {
    let served = new Response(null, { status: 404 });
    const { impl, urls } = countingFetch(() => served.clone());
    vi.stubGlobal('fetch', impl);
    const { loadIr, loadRealContent } = await freshLoaders();

    expect(await loadIr()).toBeNull();
    expect(await loadRealContent()).toBeNull();
    expect(urls).toHaveLength(2); // no memo pinned to the failure — each consumer retried

    served = new Response(JSON.stringify(MINIMAL_IR));
    const [ir, content] = await Promise.all([loadIr(), loadRealContent()]);

    expect(ir).not.toBeNull();
    expect(content).not.toBeNull();
    expect(urls).toHaveLength(3); // the retry re-fetches once, then both views share it
  });

  it('leaves an injected transport uncached and independent of the shared memo', async () => {
    const shared = countingFetch(() => new Response(JSON.stringify(MINIMAL_IR)));
    vi.stubGlobal('fetch', shared.impl);
    const { loadRealContent } = await freshLoaders();
    const injected = countingFetch(() => new Response(JSON.stringify(MINIMAL_IR)));

    await loadRealContent(injected.impl);
    await loadRealContent(injected.impl);

    expect(injected.urls).toEqual(['/ir.json', '/ir.json']);
    expect(shared.urls).toEqual([]);
  });
});
