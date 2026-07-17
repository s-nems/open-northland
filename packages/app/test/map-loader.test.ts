import { buildScene, terrainMapToScene } from '@open-northland/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTerrainMap } from '../src/slice/map-loader.js';
import { EMPTY_SNAPSHOT } from './support/snapshot.js';

/**
 * Unit tests for the app's map-loading seam — the testable core of "the shot/dev entry draws an
 * actual `content/maps/<id>.json`". The browser `fetch` + GPU pixels can't run headless, but the
 * load-bearing logic (validate the fetched JSON through `@open-northland/data`'s `parseTerrainMap`, then
 * project it through `terrainMapToScene`, with graceful fallback on a bad id / 404 / malformed file)
 * is pure once `fetch` is injected — so it's pinned here, not left to the un-self-verifiable shot PNG.
 */

/** A minimal `Response`-shaped stub for the injected fetch (only the fields `loadTerrainMap` reads). */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('loadTerrainMap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches /maps/<id>.json and validates it into a TerrainMap', async () => {
    const grid = { width: 2, height: 3, typeIds: [5, 1, 2, 5, 16, 1] };
    const fetchImpl = vi.fn(async () => jsonResponse(grid));

    const map = await loadTerrainMap('oasis_o_plenty', fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith('/maps/oasis_o_plenty.json');
    expect(map).toEqual(grid);
    if (map === null) throw new Error('expected a loaded map');

    // The loaded grid must flow straight through the same render seam the slice uses, carrying its
    // varied typeIds onto one tile per cell — i.e. the real map actually drives the drawn terrain.
    const scene = buildScene(EMPTY_SNAPSHOT, terrainMapToScene(map));
    const tiles = scene.filter((d) => d.kind === 'tile');
    expect(tiles).toHaveLength(6);
    expect(tiles.map((t) => t.typeId)).toEqual([5, 1, 2, 5, 16, 1]);
  });

  it('rejects an unsafe map id without fetching (no path traversal)', async () => {
    const fetchImpl = vi.fn();

    expect(await loadTerrainMap('../ir', fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await loadTerrainMap('a/b', fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to null on a 404 (map absent / content/ not generated)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, false, 404));

    expect(await loadTerrainMap('nope', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('falls back to null on a malformed grid (length != width*height)', async () => {
    // typeIds shorter than width*height — parseTerrainMap's zod refinement must reject it, and the
    // loader swallows the throw into a null fallback so the entry degrades to the synthetic strip.
    const bad = { width: 3, height: 3, typeIds: [1, 2] };
    const fetchImpl = vi.fn(async () => jsonResponse(bad));

    expect(await loadTerrainMap('truncated', fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});
