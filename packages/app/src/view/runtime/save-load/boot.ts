import { parseSaveGame, type SaveGame } from '@open-northland/sim';
import { diag } from '../../../diag/index.js';
import { decodeSaveText, saveDocumentOf } from './codec.js';
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

/** A staged save, with the text it was staged as: a host on another thread takes the text, which
 *  crosses as one string where the parsed save is cloned object by object. */
export interface StagedSession {
  readonly save: SaveGame | null;
  readonly text: string | null;
  readonly resume: boolean;
}

const NOTHING_STAGED: StagedSession = { save: null, text: null, resume: false };

export async function takeStagedSession(worldToken: string | null): Promise<StagedSession> {
  let pending: Awaited<ReturnType<typeof takePendingSession>>;
  try {
    pending = await takePendingSession();
  } catch (err) {
    diag.warn('boot', `pending-load store unavailable: ${String(err)}`);
    return NOTHING_STAGED;
  }
  if (pending === null) return NOTHING_STAGED;
  const text = await decodeSaveText(pending.bytes);
  return { save: stagedSaveFrom(text, worldToken), text, resume: pending.resume };
}
