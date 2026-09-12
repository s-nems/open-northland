import type { SaveGame } from '@open-northland/sim';
import { swapToEntry } from '../../../launch.js';
import type { SaveBytes } from './codec.js';
import { clearPendingLoad, storePendingLoad } from './pending-store.js';
import { relaunchSearch } from './relaunch.js';

export function rootWorldId(save: SaveGame): string | null {
  let root = save;
  while (root.parent !== undefined) root = root.parent;
  return root.header.mapId;
}

export function relatedWorldLoader(
  validate: (save: SaveGame) => Promise<void>,
  teardown: () => void,
): (save: SaveGame, bytes: SaveBytes) => Promise<void> {
  return async (save, bytes) => {
    const search = relaunchSearch(save.header);
    if (search === null) throw new Error('Saved mission has no world identity');
    await validate(save);
    await storePendingLoad(bytes);
    try {
      await swapToEntry(search, teardown);
    } catch (err) {
      await clearPendingLoad();
      throw err;
    }
  };
}
