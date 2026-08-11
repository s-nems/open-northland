import type { ReadableVfs } from '@open-northland/vfs';
import { byCodeUnit, fileNamesIn } from './dir-listing.js';

/** Every servable `.jpg` under `backdropsRoot`, sorted by name; the stills are captured locally by
 *  `npm run menu-backdrops`. The caller guards existence. */
export async function buildBackdropsIndexEntries(fs: ReadableVfs, backdropsRoot: string): Promise<string[]> {
  const names = await fileNamesIn(fs, backdropsRoot);
  return [...names].filter((name) => name.endsWith('.jpg')).sort(byCodeUnit);
}
