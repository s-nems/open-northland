import { downloadFile } from '../../../diag/index.js';
import { decodeSaveText, isGzipSave, type SaveBytes } from './codec.js';

/** A picked save file: display name, decoded JSON text, and the file's bytes exactly as picked -
 *  what a validated load stages, so the reloaded boot decodes the same artifact the user chose. */
export interface PickedSaveFile {
  readonly name: string;
  readonly contents: string;
  readonly raw: SaveBytes;
}

/** The browser's save delivery: a download whose MIME matches the payload it carries. */
export function browserSaveDownload(fileName: string, bytes: SaveBytes): void {
  downloadFile(fileName, bytes, isGzipSave(bytes) ? 'application/gzip' : 'application/json');
}

/** Decode picked bytes into the file both flows consume; throws on a corrupt gzip envelope. */
export async function pickedSaveOf(name: string, bytes: SaveBytes): Promise<PickedSaveFile> {
  return { name, contents: await decodeSaveText(bytes), raw: bytes };
}

/** Browser file picker for a save; resolves null when the dialog closes without a choice. */
export function pickSaveFile(): Promise<PickedSaveFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.gz,application/json,application/gzip';
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        if (file === undefined) {
          resolve(null);
          return;
        }
        file
          .arrayBuffer()
          .then((buffer) => pickedSaveOf(file.name, new Uint8Array(buffer)))
          .then(resolve, reject);
      },
      { once: true },
    );
    // Fired by browsers that report a dismissed dialog; elsewhere the menu's close path unpauses.
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
