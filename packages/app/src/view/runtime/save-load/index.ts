import type { SaveGame } from '@open-northland/sim';
import { entrySearch } from '../../params.js';
import { reloadDocument } from '../../platform/navigation-guard.js';
import { type SaveLoadDeps, type SaveLoadSession, saveLoadSession } from './controller.js';
import { browserSaveDownload, pickSaveFile } from './file-access.js';
import { storePendingLoad } from './pending-store.js';
import { browserReplayStore } from './replay-store.js';
import { browserSaveStore } from './store-browser.js';

export { type StagedSession, takeStagedSession } from './boot.js';
export type { LoadOutcome, SaveLoadSession, SaveOutcome } from './controller.js';
export { saveLoadSession } from './controller.js';
export { evaluateSaveFile, type LiveWorldIdentity, type SaveRejection } from './evaluate.js';
export { restoredControlGroups, type SavedView, savedView } from './view-state.js';

export interface SaveLoadSessionOptions
  extends Pick<
    SaveLoadDeps,
    | 'sessionMetadata'
    | 'viewState'
    | 'presentation'
    | 'captureSave'
    | 'captureSaveFile'
    | 'captureReplayFile'
    | 'worldSeed'
    | 'captureThumbnail'
  > {
  readonly host: SaveLoadDeps['host'];
  readonly parent?: SaveGame;
  readonly loadOtherWorld: SaveLoadDeps['loadOtherWorld'];
  readonly worldToken: string | null;
  readonly entrySearch?: string;
  readonly setPaused: (paused: boolean) => void;
  readonly isPaused: () => boolean;
}

export function createSaveLoadSession(opts: SaveLoadSessionOptions): SaveLoadSession {
  return saveLoadSession({
    ...opts,
    entrySearch: opts.entrySearch ?? entrySearch(),
    reload: reloadDocument,
    stagePending: storePendingLoad,
    store: browserSaveStore(),
    replayStore: browserReplayStore(),
    pickFile: pickSaveFile,
    downloadSave: browserSaveDownload,
  });
}
