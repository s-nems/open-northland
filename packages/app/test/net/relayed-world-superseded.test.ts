import type { GameSession } from '@open-northland/lockstep';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostMapWorld, type MapBootPlan } from '../../src/entries/map/boot.js';
import type { MapWorldDocuments } from '../../src/entries/map/world-inputs.js';
import { RelayedWorlds, WorldNotAdoptedError } from '../../src/net/relayed-worlds.js';
import type { WorkerSessionOptions } from '../../src/session/worker/protocol.js';
import * as bootstrap from '../../src/view/runtime/world-bootstrap.js';

const SILENT_STALL_REPORTS = { stalled: () => undefined, recovered: () => undefined };
const OPTIONS = { speed: 1 } as WorkerSessionOptions;
const DOCUMENTS = {} as MapWorldDocuments;

/** Host a restored world whose hosting rejects with `error`. */
function hostFailing(error: Error, multiplayer = false): Promise<null> {
  const plan: MapBootPlan<never> = {
    hostWorld: () => Promise.reject(error),
    mapId: 'forest',
    stagedSave: { header: { tick: 40, mapId: 'forest' } },
    sessionFor: () => ({}) as GameSession,
    multiplayer,
  };
  return hostMapWorld(plan, DOCUMENTS);
}

describe('a restored world that is not hosted', () => {
  const mocks = { halt: vi.fn() };
  beforeEach(() => {
    vi.spyOn(bootstrap, 'haltOnFailedRestore').mockImplementation(mocks.halt);
  });
  afterEach(() => vi.restoreAllMocks());
  it('halts the boot on a failed restore', async () => {
    mocks.halt.mockClear();
    const failed = new Error('the save does not decode');
    await expect(hostFailing(failed)).resolves.toBeNull();
    expect(mocks.halt).toHaveBeenCalledWith(failed);
  });

  it('hands a world the relay client dropped back to its entry, reporting no failed load', async () => {
    mocks.halt.mockClear();
    const dropped = new WorldNotAdoptedError();
    await expect(hostFailing(dropped)).rejects.toBe(dropped);
    expect(mocks.halt).not.toHaveBeenCalled();
  });

  it('hands a failed relayed restore to its entry, which shows the one failure', async () => {
    mocks.halt.mockClear();
    const failed = new Error('the snapshot does not decode');
    await expect(hostFailing(failed, true)).rejects.toBe(failed);
    expect(mocks.halt).not.toHaveBeenCalled();
  });
});

describe('relayed worlds', () => {
  it('fails only the opening world whose request the worker client did not adopt', async () => {
    const worlds = new RelayedWorlds<null>(() => undefined, SILENT_STALL_REPORTS);
    const first = worlds.host(1, { requestId: 1 }, OPTIONS);
    const second = worlds.host(2, { requestId: 2 }, OPTIONS);
    let secondSettled = false;
    second.then(
      () => undefined,
      () => {
        secondSettled = true;
      },
    );
    await expect(first).rejects.toBeInstanceOf(WorldNotAdoptedError);
    // The worker reports the replaced request unadopted after the next one was asked for.
    worlds.unadopted(1);
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    worlds.unadopted(2);
    await expect(second).rejects.toBeInstanceOf(WorldNotAdoptedError);
  });

  it('opens no world once its worker failed', async () => {
    const posted: unknown[] = [];
    const worlds = new RelayedWorlds<null>((message) => posted.push(message), SILENT_STALL_REPORTS);
    worlds.fail(new Error('the network worker died'));
    await expect(worlds.host(1, { requestId: 1 }, OPTIONS)).rejects.toBeInstanceOf(WorldNotAdoptedError);
    expect(posted).toEqual([]);
  });

  it('opens no world once the connection closed, so a boot still loading settles', async () => {
    const posted: unknown[] = [];
    const worlds = new RelayedWorlds<null>((message) => posted.push(message), SILENT_STALL_REPORTS);
    const opening = worlds.host(1, { requestId: 1 }, OPTIONS);
    worlds.close();
    await expect(opening).rejects.toBeInstanceOf(WorldNotAdoptedError);
    posted.length = 0;
    await expect(worlds.host(2, { requestId: 2 }, OPTIONS)).rejects.toBeInstanceOf(WorldNotAdoptedError);
    expect(posted).toEqual([]);
  });
});
