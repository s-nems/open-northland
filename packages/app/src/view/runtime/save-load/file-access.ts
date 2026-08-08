/** A picked save file: display name plus full text, never a filesystem path. */
export interface PickedSaveFile {
  readonly name: string;
  readonly contents: string;
}

/**
 * The two file operations the desktop preload adds to `window.desktop`. The app reads the bridge
 * structurally and stays shell-agnostic; `packages/desktop/src/ipc.ts` implements the same shape.
 */
export interface GameFileBridge {
  /** Native save dialog; resolves to the written file's basename, or null when the user cancels. */
  saveGameFile(suggestedName: string, contents: string): Promise<string | null>;
  /** Native open dialog; null when the user cancels. */
  openGameFile(): Promise<PickedSaveFile | null>;
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

/** Browser file picker for a save; resolves null when the dialog closes without a choice. */
export function pickSaveFile(): Promise<PickedSaveFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        if (file === undefined) {
          resolve(null);
          return;
        }
        file.text().then((contents) => resolve({ name: file.name, contents }), reject);
      },
      { once: true },
    );
    // Fired by browsers that report a dismissed dialog; elsewhere the menu's close path unpauses.
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
