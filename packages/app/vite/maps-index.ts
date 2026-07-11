import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Node-side builder for the dev server's `/maps-index` payload (`vite.config.ts` `serveMapsIndex`).
 * Lives outside `src/` with the vite config it serves — this is dev-server code, not app code — but
 * in its own module so the join logic is unit-testable against a fixture directory (the middleware
 * closure itself is unreachable from a test).
 */

/** One `/maps-index` entry: a decoded map's stem id + the pipeline's optional menu sidecars. */
export interface MapsIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  /** Whether `/maps/<id>.png` (the decoded minimap thumbnail) exists. */
  readonly minimap: boolean;
}

/**
 * Builds one entry per `content/maps/<id>.json` grid (sorted; the `.meta.json` sidecars are NOT maps
 * and are filtered out), each joined with its `<id>.meta.json` display strings and an `<id>.png`
 * existence flag. Per-entry tolerant: a missing sidecar is normal; a malformed one (unreadable,
 * non-object like `null`, wrong-typed fields) degrades that entry to its bare id with a warning —
 * one bad sidecar must never 500 the whole list. `mapsRoot` must exist (the caller guards).
 */
export function buildMapsIndexEntries(mapsRoot: string): MapsIndexEntry[] {
  return readdirSync(mapsRoot)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort()
    .map((id) => {
      let name: string | undefined;
      let description: string | undefined;
      const metaPath = join(mapsRoot, `${id}.meta.json`);
      if (existsSync(metaPath)) {
        try {
          const parsed: unknown = JSON.parse(readFileSync(metaPath, 'utf8'));
          if (typeof parsed === 'object' && parsed !== null) {
            const meta = parsed as Record<string, unknown>;
            if (typeof meta.name === 'string') name = meta.name;
            if (typeof meta.description === 'string') description = meta.description;
          } else {
            console.warn(`[vite] maps-index: ${id}.meta.json is not an object; serving the bare id`);
          }
        } catch (err) {
          console.warn(`[vite] maps-index: ${id}.meta.json unreadable: ${(err as Error).message}`);
        }
      }
      return {
        id,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        minimap: existsSync(join(mapsRoot, `${id}.png`)),
      };
    });
}
