import { parseSaveGame, type SaveGame } from '@open-northland/sim';
import { diag } from '../../../diag/index.js';
import { decodeSaveText } from './codec.js';
import { saveDocumentOf } from './evaluate.js';
import { takePendingSession } from './pending-store.js';

/** Parse staged text through the same seam that accepted it, and pin it to this boot's world. */
export function stagedSaveFrom(text: string, worldToken: string | null): SaveGame {
  const save = parseSaveGame(saveDocumentOf(text));
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
  return (await takeStagedSession(worldToken)).save;
}

export async function takeStagedSession(
  worldToken: string | null,
): Promise<{ save: SaveGame | null; resume: boolean }> {
  let pending: Awaited<ReturnType<typeof takePendingSession>>;
  try {
    pending = await takePendingSession();
  } catch (err) {
    diag.warn('boot', `pending-load store unavailable: ${String(err)}`);
    return { save: null, resume: false };
  }
  return pending === null
    ? { save: null, resume: false }
    : {
        save: stagedSaveFrom(await decodeSaveText(pending.bytes), worldToken),
        resume: pending.resume,
      };
}
