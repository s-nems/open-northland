import { exportSaveGame, Simulation, serializeSaveGame } from '@open-northland/sim';
import { beforeEach, describe, expect, it } from 'vitest';
import { testContent } from '../../../../../sim/test/fixtures/content.js';
import { takeStagedSession } from '../../../../src/view/runtime/save-load/boot.js';
import { compressSaveText } from '../../../../src/view/runtime/save-load/codec.js';
import {
  storePendingLoad,
  storePendingReplay,
} from '../../../../src/view/runtime/save-load/pending-store.js';
import {
  parseReplayDocument,
  REPLAY_FORMAT_VERSION,
  replayDocumentTextOf,
} from '../../../../src/view/runtime/save-load/replay.js';
import { installFakeIndexedDb, resetFakeIndexedDb } from '../../../support/fake-idb.js';

/**
 * The one-shot hand-off the page reload consumes: a boot picks up the staged replay's whole document
 * — its embedded save becomes the boot's own restore save, its recording the session it plays — and
 * a staged save still comes back as the save it was staged as.
 */

const MAP_ID = 'magical-forest';

function descriptorOf() {
  return {
    world: { kind: 'map' as const, mapId: MAP_ID },
    seed: 5,
    seats: [{ player: 0, mode: 'human' as const, color: 0 }],
    localSeat: 0,
    rules: {
      fog: null,
      progression: null,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
      storageCapacity: null,
      basicYield: null,
      oreYield: null,
      papers: null,
    },
    speed: 1,
  };
}

function documentTextOf(initialSaveText: string | null): string {
  return replayDocumentTextOf({
    savedAt: 1764240000000,
    startedAt: 1764239000000,
    irVersion: 7,
    identity: { clientBuild: 'test-build', gameVersion: '9.9.9-test', contentFingerprint: 'content-x' },
    mapFingerprint: null,
    stateHash: 'abcd0123',
    descriptor: descriptorOf(),
    fromTick: initialSaveText === null ? 0 : 12,
    untilTick: 40,
    initialSaveText,
    logText: '[]',
  });
}

/** A one-tick sandbox save, as an earlier session exported it. */
function savedSessionText(): string {
  const sim = new Simulation({ seed: 3, content: testContent() });
  sim.step();
  return serializeSaveGame(exportSaveGame(sim, { mapId: MAP_ID }));
}

beforeEach(() => {
  installFakeIndexedDb();
  resetFakeIndexedDb();
});

describe('taking a staged session', () => {
  it('hands a staged replay back as the document its boot plays, with no save of its own', async () => {
    const text = documentTextOf(null);
    await storePendingReplay(await compressSaveText(text));
    const staged = await takeStagedSession(null);
    expect(staged.save).toBeNull();
    expect(staged.text).toBeNull();
    expect(staged.resume).toBe(false);
    if (staged.replay === null) throw new Error('the staged replay came back as nothing');
    expect(staged.replay.document.version).toBe(REPLAY_FORMAT_VERSION);
    expect(staged.replay.document.startedAt).toBe(1764239000000);
    expect(staged.replay.document.untilTick).toBe(40);
    expect(staged.replay.document.descriptor.world).toEqual({ kind: 'map', mapId: MAP_ID });
    // The text is the one staged, whole, so the worker never re-serializes the recording.
    expect(staged.replay.text).toBe(text);
  });

  it('derives the boot restore save from the one embedded in the replay', async () => {
    const saveText = savedSessionText();
    await storePendingReplay(await compressSaveText(documentTextOf(saveText)));
    const staged = await takeStagedSession(null);
    if (staged.replay === null) throw new Error('the staged replay came back as nothing');
    expect(staged.replay.document.initialSave).toEqual(JSON.parse(saveText));
    if (staged.save === null || staged.text === null)
      throw new Error('the embedded save came back as nothing');
    expect(staged.text).toBe(JSON.stringify(staged.save));
    expect(staged.save.header.mapId).toBe(MAP_ID);
    expect(staged.resume).toBe(false);
  });

  it('still hands a staged save back as the save it was staged as', async () => {
    const saveText = savedSessionText();
    await storePendingLoad(await compressSaveText(saveText));
    const staged = await takeStagedSession(MAP_ID);
    expect(staged.replay).toBeNull();
    if (staged.save === null) throw new Error('the staged save came back as nothing');
    expect(staged.save.header.mapId).toBe(MAP_ID);
    expect(staged.resume).toBe(false);
  });

  it('boots a resumed staged save running, as a sub-mission hand-off stages it', async () => {
    const saveText = savedSessionText();
    await storePendingLoad(await compressSaveText(saveText), true);
    const staged = await takeStagedSession(MAP_ID);
    expect(staged.resume).toBe(true);
  });
});
