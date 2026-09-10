import { gunzipSync, gzipSync } from 'node:zlib';
import { parseSaveGame, type SaveGame, serializeSaveGame } from '@open-northland/sim';

/** The client-side encoding of a snapshot blob: gzip of the canonical save JSON, base64 on the wire.
 *  Level 1, since a snapshot is produced while the whole room waits. */
const GZIP_LEVEL = 1;

export function encodeSnapshot(save: SaveGame): string {
  return gzipSync(serializeSaveGame(save), { level: GZIP_LEVEL }).toString('base64');
}

export function decodeSnapshot(bytes: string): SaveGame {
  return parseSaveGame(JSON.parse(gunzipSync(Buffer.from(bytes, 'base64')).toString('utf8')));
}
