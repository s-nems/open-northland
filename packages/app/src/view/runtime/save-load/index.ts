import type { SaveGame, Simulation } from '@open-northland/sim';
import { entrySearch } from '../../params.js';
import { type SaveLoadDeps, type SaveLoadSession, type SaveOutcome, saveLoadSession } from './controller.js';
import { browserSaveDownload, desktopFileBridge, platformSavePicker } from './file-access.js';
import { storePendingLoad } from './pending-store.js';
import { createSaveStore } from './store.js';

export { takeStagedSave, takeStagedSession } from './boot.js';
export type { LoadOutcome, SaveLoadSession, SaveOutcome } from './controller.js';
export { saveLoadSession } from './controller.js';
export { evaluateSaveFile, type LiveWorldIdentity, type SaveRejection } from './evaluate.js';

export interface SaveLoadSessionOptions
  extends Pick<SaveLoadDeps, 'sessionMetadata' | 'onSaved' | 'captureSave'> {
  readonly sim: Simulation;
  readonly parent?: SaveGame;
  readonly loadRelatedWorld?: NonNullable<SaveLoadDeps['loadRelatedWorld']>;
  readonly worldToken: string | null;
  readonly entrySearch?: string;
  readonly setPaused: (paused: boolean) => void;
  readonly isPaused: () => boolean;
}

/** The browser-wired session: desktop shells route the file dialogs over the native bridge. */
export function createSaveLoadSession(opts: SaveLoadSessionOptions): SaveLoadSession {
  const bridge = desktopFileBridge();
  return saveLoadSession({
    ...opts,
    entrySearch: opts.entrySearch ?? entrySearch(),
    reload: () => window.location.reload(),
    stagePending: storePendingLoad,
    store: createSaveStore(),
    pickFile: platformSavePicker(),
    deliverSave:
      bridge !== null
        ? async (fileName, bytes): Promise<SaveOutcome> =>
            (await bridge.saveGameFile(fileName, bytes)) !== null ? { kind: 'saved' } : { kind: 'cancelled' }
        : (fileName, bytes): Promise<SaveOutcome> => {
            browserSaveDownload(fileName, bytes);
            return Promise.resolve({ kind: 'saved' });
          },
  });
}
