import { parseTerrainMap, type TerrainMapFile } from '@open-northland/data';

/**
 * The decoded-map fetch boundary: load a `content/maps/<id>.json` grid over the dev/shot vite
 * middleware. This is app-layer I/O (a browser `fetch`, never allowed in the pure sim); everything
 * downstream (`sliceTerrain`, `runSlice`, the renderer) consumes the validated result. A checkout
 * without `content/` degrades to the synthetic strip — the maps are gitignored.
 */

/**
 * A map id is a bare filename stem (no slashes/dots), so `?map=oasis_o_plenty` can only ever fetch a
 * single `content/maps/<id>.json` — never a traversal out of the maps dir. Returns null for an id that
 * isn't a safe stem, so the caller falls back to the synthetic strip rather than fetching junk.
 */
function safeMapId(id: string): string | null {
  return /^[a-z0-9_-]+$/i.test(id) ? id : null;
}

/**
 * Load a decoded map grid (`content/maps/<id>.json`, served at `/maps/<id>.json`) into the structural
 * `TerrainMapFile` the renderer + sim consume: fetch the JSON and hand it to `@open-northland/data`'s
 * `parseTerrainMap`, which zod-validates the shape + the `typeIds.length === width*height` invariant
 * before it ever reaches `terrainMapToScene`/`buildTerrainGraph`. Returns null (and logs) on a bad id,
 * a 404 (no such map / `content/` absent), or a malformed file, so the entry degrades gracefully to
 * the synthetic strip. `fetchImpl` is injectable so the validate-then-project core is unit-testable
 * without a network.
 */
export async function loadTerrainMap(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TerrainMapFile | null> {
  const safe = safeMapId(id);
  if (safe === null) {
    console.warn(`loadTerrainMap: ignoring unsafe map id "${id}"`);
    return null;
  }
  try {
    const res = await fetchImpl(`/maps/${safe}.json`);
    if (!res.ok) {
      console.warn(`loadTerrainMap: /maps/${safe}.json -> HTTP ${res.status} (falling back to the strip)`);
      return null;
    }
    return parseTerrainMap(await res.json());
  } catch (err) {
    console.warn(`loadTerrainMap: failed to load "${safe}" (${String(err)}); falling back to the strip`);
    return null;
  }
}
