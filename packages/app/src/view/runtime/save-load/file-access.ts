import { decodeSaveText, type SaveBytes } from './codec.js';

/** A picked save file: display name, decoded JSON text, and the file's bytes exactly as picked -
 *  what a validated load stages, so the reloaded boot decodes the same artifact the user chose. */
export interface PickedSaveFile {
  readonly name: string;
  readonly contents: string;
  readonly raw: SaveBytes;
}

/** A picked file's name and raw bytes as the desktop main process hands them over. */
export interface SaveFileBytes {
  readonly name: string;
  readonly bytes: SaveBytes;
}

/**
 * The two file operations the desktop preload adds to `window.desktop`. The app reads the bridge
 * structurally and stays shell-agnostic; `packages/desktop/src/ipc.ts` implements the same shape.
 */
export interface GameFileBridge {
  /** Native save dialog; resolves to the written file's basename, or null when the user cancels. */
  saveGameFile(suggestedName: string, contents: Uint8Array): Promise<string | null>;
  /** Native open dialog; null when the user cancels. */
  openGameFile(): Promise<SaveFileBytes | null>;
}

declare global {
  interface Window {
    readonly desktop?: GameFileBridge;
  }
}

/** The desktop shell's file bridge, or null in a plain browser. Feature-checked per method: the
 *  preload predates these methods in older shells. */
export function desktopFileBridge(): GameFileBridge | null {
  const bridge = window.desktop;
  if (bridge === undefined) return null;
  const partial = bridge as Partial<GameFileBridge>;
  return typeof partial.saveGameFile === 'function' && typeof partial.openGameFile === 'function'
    ? bridge
    : null;
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
