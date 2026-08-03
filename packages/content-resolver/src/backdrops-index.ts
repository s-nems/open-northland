import { readdirSync } from 'node:fs';

/**
 * Node-side builder for the `/backdrops-index` payload: the menu-backdrop stills under
 * `content/backdrops/`, captured locally by `npm run menu-backdrops`.
 */

/** Every servable `.jpg` under `backdropsRoot`, sorted by name. The caller guards existence. */
export function buildBackdropsIndexEntries(backdropsRoot: string): string[] {
  return readdirSync(backdropsRoot)
    .filter((file) => file.endsWith('.jpg'))
    .sort((a, b) => a.localeCompare(b));
}
