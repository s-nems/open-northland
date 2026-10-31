import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFESSIONS } from '../../../src/catalog/professions.js';
import { FISH_ATLAS } from '../../../src/content/fish-gfx.js';
import { contentDir, hasRealIr, loadContentUnderTest, servedAtlasManifest } from '../helpers.js';

/** Serves the content under test off disk at the root-relative URLs the icon loaders fetch. */
const serveContent: typeof fetch = async (input) => {
  try {
    return new Response(await readFile(resolve(contentDir(), `.${String(input)}`)));
  } catch {
    return new Response(null, { status: 404 });
  }
};

describe.runIf(hasRealIr())('profession icons in the decoded content', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cuts the prey token from a served animal sheet', async () => {
    const { merge } = await loadContentUnderTest();
    vi.stubGlobal('fetch', serveContent);
    vi.resetModules();
    const { goodIconSource } = await import('../../../src/hud/dom/good-art.js');
    expect(await goodIconSource('prey', null, merge.content)).not.toBeNull();
  });

  it('cuts every trade icon from a served sheet', async () => {
    const { merge } = await loadContentUnderTest();
    vi.stubGlobal('fetch', serveContent);
    // The icon loaders memoize their fetches, so they load afresh under the stub.
    vi.resetModules();
    const { goodIconSource } = await import('../../../src/hud/dom/good-art.js');
    const unresolved: string[] = [];
    for (const { key, icon } of PROFESSIONS) {
      if (icon !== undefined && (await goodIconSource(icon, null, merge.content)) === null)
        unresolved.push(`${key}: ${icon}`);
    }
    expect(unresolved).toEqual([]);
  });

  it("draws the fisher's fish from the swarm sheet, not the gold bar its pile copies", async () => {
    const { merge } = await loadContentUnderTest();
    vi.stubGlobal('fetch', serveContent);
    vi.resetModules();
    const { goodIconSource } = await import('../../../src/hud/dom/good-art.js');
    const fishSheet = servedAtlasManifest(FISH_ATLAS)?.image;
    expect(fishSheet).toBeDefined();
    expect((await goodIconSource('fish', null, merge.content))?.url).toBe(`/bobs/${fishSheet}`);
  });
});
