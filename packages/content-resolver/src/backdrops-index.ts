import type { Vfs } from '@open-northland/vfs';

/** Every servable `.jpg` under `backdropsRoot`, sorted by name; the stills are captured locally by
 *  `npm run menu-backdrops`. The caller guards existence. */
export async function buildBackdropsIndexEntries(fs: Vfs, backdropsRoot: string): Promise<string[]> {
  return (await fs.readdir(backdropsRoot))
    .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.jpg'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}
