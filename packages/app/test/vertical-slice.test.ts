import { buildScene, terrainMapToScene } from '@vinland/render';
import type { WorldSnapshot } from '@vinland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTerrainMap, sliceTerrain } from '../src/vertical-slice.js';

/**
 * Unit tests for the app's map-loading seam — the testable core of "the shot/dev entry draws an
 * actual `content/maps/<id>.json`". The browser `fetch` + GPU pixels can't run headless, but the
 * load-bearing logic (validate the fetched JSON through `@vinland/data`'s `parseTerrainMap`, then
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

const EMPTY_SNAPSHOT: WorldSnapshot = { tick: 0, entities: [], events: [] };

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
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await loadTerrainMap('../ir', fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await loadTerrainMap('a/b', fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to null on a 404 (map absent / content/ not generated)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, false, 404));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await loadTerrainMap('nope', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('falls back to null on a malformed grid (length != width*height)', async () => {
    // typeIds shorter than width*height — parseTerrainMap's zod refinement must reject it, and the
    // loader swallows the throw into a null fallback so the entry degrades to the synthetic strip.
    const bad = { width: 3, height: 3, typeIds: [1, 2] };
    const fetchImpl = vi.fn(async () => jsonResponse(bad));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await loadTerrainMap('truncated', fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});

describe('sliceTerrain', () => {
  it('projects an injected map, else the synthetic grass strip', () => {
    // Default (no map) = the reproducible 6×1 grass strip the shot PNG + golden depend on.
    const fallback = sliceTerrain();
    expect(fallback.width).toBe(6);
    expect(fallback.height).toBe(1);
    expect(fallback.typeIds).toEqual([0, 0, 0, 0, 0, 0]);

    // An injected (loaded) map drives the terrain instead.
    const loaded = sliceTerrain({ width: 2, height: 1, typeIds: [4, 9] });
    expect(loaded).toEqual({ width: 2, height: 1, typeIds: [4, 9] });
  });
});
