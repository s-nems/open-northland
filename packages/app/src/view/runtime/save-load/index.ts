import type { Simulation } from '@open-northland/sim';
import { downloadJsonFile } from '../../../diag/index.js';
import { type SaveLoadSession, type SaveOutcome, saveLoadSession } from './controller.js';
import { desktopFileBridge, pickSaveFile } from './file-access.js';
import { storePendingLoad } from './pending-store.js';

export { takeStagedSave } from './boot.js';
export type { LoadOutcome, SaveLoadSession, SaveOutcome } from './controller.js';
export { saveLoadSession } from './controller.js';
export { evaluateSaveFile, type LiveWorldIdentity, type SaveRejection } from './evaluate.js';
export type { GameFileBridge, PickedSaveFile } from './file-access.js';

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
    pickFile: bridge !== null ? () => bridge.openGameFile() : pickSaveFile,
    deliverSave:
      bridge !== null
        ? async (fileName, bytes): Promise<SaveOutcome> =>
            (await bridge.saveGameFile(fileName, bytes)) !== null ? { kind: 'saved' } : { kind: 'cancelled' }
        : (fileName, bytes): Promise<SaveOutcome> => {
            downloadJsonFile(fileName, bytes);
            return Promise.resolve({ kind: 'saved' });
          },
  });
}
