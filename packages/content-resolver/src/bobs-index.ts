import { type Vfs, vjoin } from '@open-northland/vfs';
import type { BobsIndexEntry } from './wire.js';

/** One entry per viewable atlas - a palette-applied `<stem>.png` + `<stem>.atlas.json` pair - sorted
 *  by (base, variant). `bobsRoot` must exist - the caller guards. */
export async function buildBobsIndexEntries(fs: Vfs, bobsRoot: string): Promise<BobsIndexEntry[]> {
  const candidates = (await fs.readdir(bobsRoot))
    .filter((e) => e.kind === 'file' && e.name.endsWith('.atlas.json'))
    .map((e) => e.name.slice(0, -'.atlas.json'.length))
    // An `.indexed` sheet holds a palette index in red and a mask in alpha, not a viewable image.
    .filter((stem) => !stem.endsWith('.indexed'));
  const stems: string[] = [];
  for (const stem of candidates) {
    if ((await fs.stat(vjoin(bobsRoot, `${stem}.png`)))?.kind === 'file') stems.push(stem);
  }

  return stems
    .map((stem) => {
      const dot = stem.indexOf('.');
      const base = dot === -1 ? stem : stem.slice(0, dot);
      const variant = dot === -1 ? '' : stem.slice(dot + 1);
      return { stem, base, variant };
    })
    .sort((a, b) => a.base.localeCompare(b.base) || a.variant.localeCompare(b.variant));
}
