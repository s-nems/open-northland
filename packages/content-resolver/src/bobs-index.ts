import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BobsIndexEntry } from './wire.js';

/** One entry per viewable atlas - a palette-applied `<stem>.png` + `<stem>.atlas.json` pair - sorted
 *  by (base, variant). `bobsRoot` must exist - the caller guards. */
export function buildBobsIndexEntries(bobsRoot: string): BobsIndexEntry[] {
  const stems = readdirSync(bobsRoot)
    .filter((f) => f.endsWith('.atlas.json'))
    .map((f) => f.slice(0, -'.atlas.json'.length))
    // An `.indexed` sheet holds a palette index in red and a mask in alpha, not a viewable image.
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
