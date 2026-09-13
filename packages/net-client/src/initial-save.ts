import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { type InitialSaveIdentity, parseInitialSaveIdentity } from '@open-northland/lockstep';
import { parseBlobBytes } from '@open-northland/net-protocol';
import { parseSaveGame, type SaveGame } from '@open-northland/sim';
import { decodeSnapshot, encodeSnapshot } from './snapshot-codec.js';

export interface PreparedInitialSave {
  readonly identity: InitialSaveIdentity;
  readonly bytes: string;
}

async function fingerprint(bytes: string): Promise<string> {
  return bytesToHex(sha256(new TextEncoder().encode(bytes)));
}

export async function prepareInitialSave(save: SaveGame): Promise<PreparedInitialSave> {
  const parsed = parseSaveGame(save);
  const bytes = parseBlobBytes(await encodeSnapshot(parsed), 'initialSave');
  return { identity: { fingerprint: await fingerprint(bytes), tick: parsed.header.tick }, bytes };
}

/** Integrity and save schema checks precede the host's content-aware restore validation. */
export async function verifyInitialSave(
  bytes: string,
  identity: InitialSaveIdentity,
  mapId: string | null,
): Promise<SaveGame> {
  parseInitialSaveIdentity(identity);
  parseBlobBytes(bytes, 'initialSave');
  if ((await fingerprint(bytes)) !== identity.fingerprint)
    throw new Error('initial save fingerprint mismatch');
  const save = await decodeSnapshot(bytes);
  if (save.header.tick !== identity.tick) throw new Error('initial save tick mismatch');
  if (save.header.mapId !== mapId) throw new Error('initial save map mismatch');
  return save;
}
