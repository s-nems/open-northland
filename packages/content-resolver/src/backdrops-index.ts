import { readdirSync } from 'node:fs';

/** Every servable `.jpg` under `backdropsRoot`, sorted by name; the stills are captured locally by
 *  `npm run menu-backdrops`. The caller guards existence. */
export function buildBackdropsIndexEntries(backdropsRoot: string): string[] {
  return readdirSync(backdropsRoot)
    .filter((file) => file.endsWith('.jpg'))
    .sort((a, b) => a.localeCompare(b));
}
