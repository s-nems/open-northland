// @vitest-environment jsdom
import type { GameSession } from '@open-northland/lockstep';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostedMapWorld, MapBootPlan } from '../src/entries/map/boot.js';

const mocks = vi.hoisted(() => ({
  appDestroy: vi.fn(),
  sprites: vi.fn(),
  terrain: vi.fn(),
  haltOnMissingContent: vi.fn(),
  haltOnFailedRestore: vi.fn(),
}));
vi.mock('@open-northland/render', async (original) => ({
  ...(await original<typeof import('@open-northland/render')>()),
  createWindowPixiApp: async () => ({ destroy: mocks.appDestroy, renderer: {} }),
}));
vi.mock('../src/view/boot-progress.js', () => ({
  mountBootProgress: () => ({ begin: async () => undefined, finish: async () => undefined }),
}));
vi.mock('../src/view/settings-store.js', () => ({
  readStoredSettings: () => ({ renderScale: 1, debugToolsEnabled: false }),
}));
vi.mock('../src/content/ir/load.js', () => ({ loadIr: async () => null }));
vi.mock('../src/content/sprite-sheet/index.js', () => ({ resolveSpriteSheet: mocks.sprites }));
vi.mock('../src/content/terrain.js', async (original) => ({
  ...(await original<typeof import('../src/content/terrain.js')>()),
  loadRealTerrain: mocks.terrain,
}));
vi.mock('../src/view/runtime/world-bootstrap.js', () => ({
  loadLocalizedRealContent: async () => ({ goodNames: new Map(), realContent: null }),
  createWorldRenderer: () => {
    throw new Error('the early exits never reach the renderer');
  },
  haltOnMissingContent: mocks.haltOnMissingContent,
  haltOnFailedRestore: mocks.haltOnFailedRestore,
}));

import { MissingTerrainError } from '../src/content/terrain.js';
import { assembleMapWorld } from '../src/entries/map/boot.js';

const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
const STAGED = { header: { tick: 40, mapId: null } };

/** A promise with its settle handles, for ordering the worker against the art load. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function plan(hostWorld: () => Promise<HostedMapWorld>, staged = true): MapBootPlan<HostedMapWorld> {
  return { hostWorld, mapId: null, stagedSave: staged ? STAGED : null, sessionFor: () => SESSION };
}

const HOSTED = { host: {}, placements: {}, matchRules: {}, seed: 1 } as unknown as HostedMapWorld;

function assemble(boot: MapBootPlan<HostedMapWorld>) {
  return assembleMapWorld({} as HTMLCanvasElement, new URLSearchParams(), boot);
}

describe('assembleMapWorld with the world hosted during the art load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.terrain.mockResolvedValue({});
  });

  it('stops after the sprites when the staged save failed to restore, with one notice', async () => {
    const sprites = deferred<object>();
    mocks.sprites.mockReturnValue(sprites.promise);
    const assembled = assemble(plan(() => Promise.reject(new Error('restore failed'))));
    await vi.waitFor(() => expect(mocks.sprites).toHaveBeenCalled());
    sprites.resolve({});
    expect(await assembled).toBeNull();
    expect(mocks.haltOnFailedRestore).toHaveBeenCalledTimes(1);
    expect(mocks.terrain).not.toHaveBeenCalled();
    expect(mocks.haltOnMissingContent).not.toHaveBeenCalled();
  });

  it('shows only the restore notice when the sprites throw after the world failed', async () => {
    const sprites = deferred<object>();
    mocks.sprites.mockReturnValue(sprites.promise);
    const assembled = assemble(plan(() => Promise.reject(new Error('restore failed'))));
    await vi.waitFor(() => expect(mocks.sprites).toHaveBeenCalled());
    sprites.reject(new Error('atlas unreadable'));
    expect(await assembled).toBeNull();
    expect(mocks.haltOnFailedRestore).toHaveBeenCalledTimes(1);
  });

  it('halts on missing terrain after the worker is ready, without a restore notice', async () => {
    mocks.sprites.mockResolvedValue({});
    mocks.terrain.mockRejectedValue(new MissingTerrainError('no terrain'));
    expect(await assemble(plan(async () => HOSTED))).toBeNull();
    expect(mocks.haltOnMissingContent).toHaveBeenCalledTimes(1);
    expect(mocks.haltOnFailedRestore).not.toHaveBeenCalled();
    expect(mocks.appDestroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the missing-terrain notice the only one when the restore fails afterwards', async () => {
    const hosting = deferred<HostedMapWorld>();
    mocks.sprites.mockResolvedValue({});
    mocks.terrain.mockRejectedValue(new MissingTerrainError('no terrain'));
    let settled = false;
    const assembled = assemble(plan(() => hosting.promise)).then((world) => {
      settled = true;
      return world;
    });
    await vi.waitFor(() => expect(mocks.haltOnMissingContent).toHaveBeenCalledTimes(1));
    // The boot waits for the worker it started, so the entry can dispose it.
    expect(settled).toBe(false);
    hosting.reject(new Error('restore failed'));
    expect(await assembled).toBeNull();
    expect(mocks.haltOnFailedRestore).not.toHaveBeenCalled();
  });

  it('surfaces a sprite failure only once the worker it started has stood up', async () => {
    const hosting = deferred<HostedMapWorld>();
    mocks.sprites.mockRejectedValue(new Error('atlas unreadable'));
    let settled = false;
    const assembled = assemble(plan(() => hosting.promise, false)).catch((error: unknown) => {
      settled = true;
      throw error;
    });
    await vi.waitFor(() => expect(mocks.appDestroy).toHaveBeenCalled());
    expect(settled).toBe(false);
    hosting.resolve(HOSTED);
    await expect(assembled).rejects.toThrow('atlas unreadable');
    expect(mocks.haltOnFailedRestore).not.toHaveBeenCalled();
    expect(mocks.haltOnMissingContent).not.toHaveBeenCalled();
  });
});
