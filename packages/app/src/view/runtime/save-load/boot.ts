import { parseSaveGame, type SaveGame } from '@open-northland/sim';
import { diag } from '../../../diag/index.js';
import { saveDocumentOf } from './evaluate.js';
import { takePendingLoad } from './pending-store.js';

/** Parse staged bytes through the same seam that accepted them, and pin them to this boot's world. */
export function stagedSaveFrom(bytes: string, worldToken: string | null): SaveGame {
  const save = parseSaveGame(saveDocumentOf(bytes));
  if (save.header.mapId !== worldToken) {
    throw new Error(
      `staged save names world ${JSON.stringify(save.header.mapId)}, this boot is ${JSON.stringify(worldToken)}`,
    );
  }
  return save;
}

/**
 * The staged save this boot must restore, or null for a normal fresh boot. Taking is destructive, so
 * any failure from here on throws for the entry's halt overlay rather than silently starting a fresh
 * world. An unreadable store degrades to a fresh boot: nothing was staged that could be lost.
 */
export async function takeStagedSave(worldToken: string | null): Promise<SaveGame | null> {
  let bytes: string | null;
  try {
    bytes = await takePendingLoad();
  } catch (err) {
    diag.warn('boot', `pending-load store unavailable: ${String(err)}`);
    return null;
  }
  return bytes === null ? null : stagedSaveFrom(bytes, worldToken);
}
