import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BobsIndexEntry } from './wire.js';

/**
 * Node-side builder for the `/bobs-index` payload - the list the in-app icon gallery (`?icons`)
 * browses: every viewable atlas, meaning a palette-applied `<stem>.png` + `<stem>.atlas.json` pair.
 * The `.indexed.*` sheets carry a palette index in the red channel for the runtime recolour rather
 * than a viewable image, so they are skipped.
 */

/** Build one entry per viewable atlas under `bobsRoot`, sorted by (base, variant). `bobsRoot` must
 *  exist - the caller guards. */
export function buildBobsIndexEntries(bobsRoot: string): BobsIndexEntry[] {
  const stems = readdirSync(bobsRoot)
    .filter((f) => f.endsWith('.atlas.json'))
    .map((f) => f.slice(0, -'.atlas.json'.length))
    .filter((stem) => !stem.endsWith('.indexed') && existsSync(join(bobsRoot, `${stem}.png`)));

  return stems
    .map((stem) => {
      const dot = stem.indexOf('.');
      const base = dot === -1 ? stem : stem.slice(0, dot);
      const variant = dot === -1 ? '' : stem.slice(dot + 1);
      return { stem, base, variant };
    })
    .sort((a, b) => a.base.localeCompare(b.base) || a.variant.localeCompare(b.variant));
}
