import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Node-side builder for the `/maps-index` payload — the decoded-maps list the app menu renders. */

/** One `/maps-index` entry: a decoded map's stem id + the pipeline's optional menu sidecars. */
export interface MapsIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  /** Whether `/maps/<id>.png` (the decoded minimap thumbnail) exists. */
  readonly minimap: boolean;
}

/**
 * One entry per `content/maps/<id>.json` grid, sorted, with the `.meta.json` sidecars filtered out;
 * each is joined with its `<id>.meta.json` display strings and an `<id>.png` existence flag. A
 * missing sidecar is normal, and a malformed one (unreadable, non-object, wrong-typed fields)
 * degrades that entry to its bare id with a warning so one bad file cannot fail the whole list.
 * `mapsRoot` must exist — the caller guards.
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
            console.warn(
              `[content-routes] maps-index: ${id}.meta.json is not an object; serving the bare id`,
            );
          }
        } catch (err) {
          console.warn(`[content-routes] maps-index: ${id}.meta.json unreadable: ${(err as Error).message}`);
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
