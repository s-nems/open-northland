import type { Simulation } from '@open-northland/sim';
import { downloadFile } from '../../../diag/index.js';
import { type SaveLoadSession, type SaveOutcome, saveLoadSession } from './controller.js';
import { desktopFileBridge, pickedSaveOf, pickSaveFile } from './file-access.js';
import { storePendingLoad } from './pending-store.js';

export { takeStagedSave } from './boot.js';
export type { LoadOutcome, SaveLoadSession, SaveOutcome } from './controller.js';
export { saveLoadSession } from './controller.js';
export { evaluateSaveFile, type LiveWorldIdentity, type SaveRejection } from './evaluate.js';
export type { GameFileBridge, PickedSaveFile, SaveFileBytes } from './file-access.js';

export interface SaveLoadSessionOptions {
  readonly sim: Simulation;
  readonly worldToken: string | null;
  readonly setPaused: (paused: boolean) => void;
  readonly isPaused: () => boolean;
}

/** The browser-wired session: desktop shells route both dialogs over the native file bridge. */
export function createSaveLoadSession(opts: SaveLoadSessionOptions): SaveLoadSession {
  const bridge = desktopFileBridge();
  return saveLoadSession({
    ...opts,
    reload: () => window.location.reload(),
    stagePending: storePendingLoad,
    pickFile:
      bridge !== null
        ? async () => {
            const picked = await bridge.openGameFile();
            return picked === null ? null : pickedSaveOf(picked.name, picked.bytes);
          }
        : pickSaveFile,
    deliverSave:
      bridge !== null
        ? async (fileName, bytes): Promise<SaveOutcome> =>
            (await bridge.saveGameFile(fileName, bytes)) !== null ? { kind: 'saved' } : { kind: 'cancelled' }
        : (fileName, bytes): Promise<SaveOutcome> => {
            downloadFile(fileName, bytes, 'application/gzip');
            return Promise.resolve({ kind: 'saved' });
          },
  });
}
