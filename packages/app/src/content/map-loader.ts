import { MapScript, parseTerrainMap, type TerrainMapFile } from '@open-northland/data';
import { withBaseUrl } from '../base-url.js';
import { diag } from '../diag/index.js';

/**
 * The decoded-map fetch boundary: app-layer I/O for a `content/maps/<id>.json` grid, never allowed in the
 * pure sim. The maps are gitignored, so a checkout without `content/` degrades to the demo world.
 */

/**
 * A map id must be a bare filename stem, so `?map=` can only ever fetch a single
 * `content/maps/<id>.json` and never traverse out of the maps dir. Null for anything else.
 */
function safeMapId(id: string): string | null {
  return /^[a-z0-9_-]+$/i.test(id) ? id : null;
}

/**
 * Load a decoded map grid into the structural `TerrainMapFile` the renderer and sim consume, validated by
 * `parseTerrainMap` before it reaches either. Returns null (and logs) on a bad id, a 404, or a malformed
 * file, so the entry degrades to the synthetic strip. `fetchImpl` is injectable for testing without a
 * network.
 */
export async function loadTerrainMap(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TerrainMapFile | null> {
  const safe = safeMapId(id);
  if (safe === null) {
    diag.warn('content', `loadTerrainMap: ignoring unsafe map id "${id}"`);
    return null;
  }
  try {
    const res = await fetchImpl(withBaseUrl(`/maps/${safe}.json`));
    if (!res.ok) {
      diag.warn(
        'content',
        `loadTerrainMap: /maps/${safe}.json -> HTTP ${res.status} (falling back to the strip)`,
      );
      return null;
    }
    return parseTerrainMap(await res.json());
  } catch (err) {
    diag.warn(
      'content',
      `loadTerrainMap: failed to load "${safe}" (${String(err)}); falling back to the strip`,
    );
    return null;
  }
}

/**
 * Load a decoded map's script sidecar: the player roster, diplomacy and mission triggers. A 404 is normal
 * absence and returns null silently; a malformed file returns null with a warning, so the entry degrades
 * to the roster-less defaults.
 */
export async function loadMapScript(id: string, fetchImpl: typeof fetch = fetch): Promise<MapScript | null> {
  const safe = safeMapId(id);
  if (safe === null) return null;
  try {
    const res = await fetchImpl(withBaseUrl(`/maps/${safe}.script.json`));
    if (!res.ok) return null;
    return MapScript.parse(await res.json());
  } catch (err) {
    diag.warn('content', `loadMapScript: malformed /maps/${safe}.script.json (${String(err)})`);
    return null;
  }
}
