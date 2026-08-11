import type { ReadableVfs } from '@open-northland/vfs';
import { byCodeUnit, fileNamesIn } from './dir-listing.js';
import type { BobsIndexEntry } from './wire.js';

/** One entry per viewable atlas - a palette-applied `<stem>.png` + `<stem>.atlas.json` pair - sorted
 *  by (base, variant). `bobsRoot` must exist - the caller guards. */
export async function buildBobsIndexEntries(fs: ReadableVfs, bobsRoot: string): Promise<BobsIndexEntry[]> {
  const names = await fileNamesIn(fs, bobsRoot);

  return (
    [...names]
      .filter((name) => name.endsWith('.atlas.json'))
      .map((name) => name.slice(0, -'.atlas.json'.length))
      // An `.indexed` sheet holds a palette index in red and a mask in alpha, not a viewable image.
      .filter((stem) => !stem.endsWith('.indexed'))
      .filter((stem) => names.has(`${stem}.png`))
      .map((stem) => {
        const dot = stem.indexOf('.');
        const base = dot === -1 ? stem : stem.slice(0, dot);
        const variant = dot === -1 ? '' : stem.slice(dot + 1);
        return { stem, base, variant };
      })
      .sort((a, b) => byCodeUnit(a.base, b.base) || byCodeUnit(a.variant, b.variant))
  );
}
