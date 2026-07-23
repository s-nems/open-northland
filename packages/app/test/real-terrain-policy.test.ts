import type { TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';

/**
 * `loadRealTerrain` owns the missing-content policy: an absent `ir.json` and a `content/` that serves
 * not one referenced ground texture page both reject with `MissingTerrainError` (the playable entries
 * halt boot on exactly that error instead of drawing a flat world), while a partially served
 * `content/` still degrades per page. Driven through the injectable page loader, so no GPU is needed.
 */

// Pre-transform the Pixi-heavy module graph outside any test body: a cold Vite transform of
// `@open-northland/render` costs seconds that would otherwise be charged to the first test's timeout.
await import('../src/content/terrain.js');

/** Generous: even primed, a cold-cache run pays a real (multi-second) transform for this graph. */
const TERRAIN_TIMEOUT_MS = 30_000;

type Coords = [number, number, number, number, number, number];
const COORDS: Coords = [0, 0, 63, 63, 0, 63];

const LAND_TYPE = 1;
const PATTERN_NAME = 'block meadow 01';
/** The `TrianglePatternType` land class (water=1 / land=2 / mountain=3). */
const LOGIC_LAND = 2;

/** One per-typeId binding on `text_001` plus one named 1:1 pattern on `text_002`. */
const IR: ContentIr = {
  terrainPatterns: [
    {
      typeId: LAND_TYPE,
      family: 'land',
      patternId: 0,
      logicType: LOGIC_LAND,
      texture: 'data/engine2d/bilder/terrain/text_001.pcx',
      coordsA: COORDS,
      coordsB: COORDS,
    },
  ],
  gfxPatterns: [
    {
      id: 0,
      editName: PATTERN_NAME,
      editGroups: [],
      logicType: LOGIC_LAND,
      texture: 'data/engine2d/bilder/terrain/text_002.pcx',
      coordsA: COORDS,
      coordsB: COORDS,
    },
  ],
};

/** A fresh module graph, so the memoized `ir.json` fetch behind `loadIr` starts empty. */
async function freshTerrain() {
  vi.resetModules();
  return await import('../src/content/terrain.js');
}

/** A page loader resolving the given page keys and failing every other referenced page. */
function pageLoaderServing(...keys: readonly string[]) {
  return vi.fn((url: string): Promise<TextureSource> => {
    const served = keys.some((key) => url === `/textures/${key}.png`);
    return served
      ? Promise.resolve({ label: url } as unknown as TextureSource)
      : Promise.reject(new Error(`unserved page ${url}`));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the real-terrain missing-content policy', { timeout: TERRAIN_TIMEOUT_MS }, () => {
  it('rejects with MissingTerrainError when content/ir.json is not served', async () => {
    const notServed: typeof fetch = () => Promise.resolve(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', notServed);
    const { loadRealTerrain, MissingTerrainError } = await freshTerrain();

    const failed = loadRealTerrain();

    await expect(failed).rejects.toThrow(MissingTerrainError);
    await expect(failed).rejects.toThrow(/ir\.json not found/);
  });

  it('trusts a caller-resolved null IR without refetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { loadRealTerrain, MissingTerrainError } = await freshTerrain();

    await expect(loadRealTerrain(null)).rejects.toThrow(MissingTerrainError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects with MissingTerrainError when no referenced texture page loads', async () => {
    const { loadRealTerrain, MissingTerrainError } = await freshTerrain();

    const failed = loadRealTerrain(IR, pageLoaderServing(/* nothing */));

    await expect(failed).rejects.toThrow(MissingTerrainError);
    await expect(failed).rejects.toThrow(/no loadable ground texture pages/);
  });

  it('rejects an IR without terrain lanes instead of returning an all-fallback set', async () => {
    const { loadRealTerrain, MissingTerrainError } = await freshTerrain();
    const loadPage = pageLoaderServing('text_001');

    await expect(loadRealTerrain({}, loadPage)).rejects.toThrow(MissingTerrainError);
    expect(loadPage).not.toHaveBeenCalled(); // nothing referenced, nothing fetched
  });

  it('degrades per page while at least one referenced page loads', async () => {
    const { loadRealTerrain } = await freshTerrain();

    const set = await loadRealTerrain(IR, pageLoaderServing('text_001'));

    expect(set.pages.has('text_001')).toBe(true);
    expect(set.pages.has('text_002')).toBe(false);
    expect(set.cellFor(LAND_TYPE)).toMatchObject({ pageKey: 'text_001' });
    // The 1:1 join survives its failed page: the renderer falls back per triangle, not per set.
    expect(set.groundFor?.(PATTERN_NAME)).toMatchObject({ pageKey: 'text_002' });
  });
});
