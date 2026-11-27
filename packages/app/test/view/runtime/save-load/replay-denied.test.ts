import { describe, expect, it } from 'vitest';
import { testContent } from '../../../../../sim/test/fixtures/content.js';
import { saveLoadSession } from '../../../../src/view/runtime/save-load/controller.js';
import { REPLAY_CAPTURE_DENIED } from '../../../../src/view/runtime/save-load/replay.js';
import type { ReplayStore } from '../../../../src/view/runtime/save-load/replay-store.js';

/** The controller's denial handling: a capture the session refuses is its own outcome, worded as a
 *  lock by the windows, while any other capture fault stays an ordinary failure. */

function sessionOf(denyWith: string) {
  const replayStore: ReplayStore = {
    list: async () => [],
    read: async () => null,
    write: async () => undefined,
    remove: async () => undefined,
  };
  return saveLoadSession({
    host: {
      mapFingerprint: undefined,
      content: testContent(),
      exportSave: () => {
        throw new Error('unexpected save export');
      },
    },
    captureReplayFile: async () => {
      throw new Error(denyWith);
    },
    replayStore,
    loadOtherWorld: async () => undefined,
    worldToken: null,
    entrySearch: null,
    setPaused: () => undefined,
    isPaused: () => false,
    reload: () => undefined,
    stagePending: async () => undefined,
    pickFile: async () => null,
    downloadSave: () => undefined,
    store: {
      list: async () => [],
      read: async () => null,
      write: async () => undefined,
      remove: async () => undefined,
    },
  });
}

describe('saving the session replay', () => {
  it("says 'denied' when the session refuses captures, not that the save failed", async () => {
    const session = sessionOf(REPLAY_CAPTURE_DENIED);
    expect(await session.saveReplay()).toEqual({ kind: 'denied' });
  });

  it('keeps an ordinary capture fault a failure', async () => {
    const session = sessionOf('the worker ran out of air');
    expect(await session.saveReplay()).toEqual({ kind: 'failed' });
  });
});
