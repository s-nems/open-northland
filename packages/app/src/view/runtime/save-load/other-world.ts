import type { SaveGame } from '@open-northland/sim';
import { swapToEntry } from '../../../launch.js';
import { targetSearch } from '../../target-search.js';
import type { SaveBytes } from './codec.js';
import { clearPendingLoad, storePendingLoad } from './pending-store.js';
import { relaunchSearch } from './relaunch.js';

/**
 * Loads a save into its own session from inside a running game, the way the main menu launches one.
 * `validate` restores the save off to the side first, so a save that cannot restore never tears the
 * running world down.
 */
export function otherWorldLoader(
  teardown: () => void,
  validate?: (save: SaveGame) => Promise<void>,
): (save: SaveGame, bytes: SaveBytes) => Promise<void> {
  return async (save, bytes) => {
    const search = relaunchSearch(save.header);
    if (search === null) throw new Error('Save has no world identity');
    await validate?.(save);
    await storePendingLoad(bytes);
    try {
      await swapToEntry(targetSearch(search), teardown);
    } catch (err) {
      await clearPendingLoad();
      throw err;
    }
  };
}
