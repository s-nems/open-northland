import type { SaveGame } from '@open-northland/sim';
import { swapToEntry } from '../../../launch.js';
import { HUMAN_TRIBE_PARAM } from '../../params.js';
import { targetSearch } from '../../target-search.js';
import type { SaveBytes } from './codec.js';
import { clearPendingLoad, storePendingLoad } from './pending-store.js';
import { relaunchSearch } from './relaunch.js';

/** The save's launch search over the running page's carried settings. An entry rebuilt from the world
 *  alone also takes the person's chosen civilization, which it would otherwise drop. */
export function otherWorldSearch(
  header: Pick<SaveGame['header'], 'mapId' | 'entry'>,
  current = new URLSearchParams(window.location.search),
): string | null {
  const search = relaunchSearch(header);
  if (search === null) return null;
  const tribe = current.get(HUMAN_TRIBE_PARAM);
  if (search === header.entry || tribe === null) return targetSearch(search, current);
  const entry = new URLSearchParams(search.slice(1));
  entry.set(HUMAN_TRIBE_PARAM, tribe);
  return targetSearch(`?${entry.toString()}`, current);
}

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
    const search = otherWorldSearch(save.header);
    if (search === null) throw new Error('Save has no world identity');
    await validate?.(save);
    await storePendingLoad(bytes);
    try {
      await swapToEntry(search, teardown);
    } catch (err) {
      await clearPendingLoad();
      throw err;
    }
  };
}
