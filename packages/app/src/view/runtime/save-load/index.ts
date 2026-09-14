import type { SaveGame, Simulation } from '@open-northland/sim';
import { entrySearch } from '../../params.js';
import { type SaveLoadDeps, type SaveLoadSession, saveLoadSession } from './controller.js';
import { browserSaveDownload, pickSaveFile } from './file-access.js';
import { storePendingLoad } from './pending-store.js';
import { browserSaveStore } from './store-browser.js';

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

export function createSaveLoadSession(opts: SaveLoadSessionOptions): SaveLoadSession {
  return saveLoadSession({
    ...opts,
    entrySearch: opts.entrySearch ?? entrySearch(),
    reload: () => window.location.reload(),
    stagePending: storePendingLoad,
    store: browserSaveStore(),
    pickFile: pickSaveFile,
    downloadSave: browserSaveDownload,
  });
}
