import type { MinimapObjects, SceneTerrain } from '@open-northland/render';
import { applyMinimapGroundMode } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import {
  createCachedMinimapBake,
  createWorkerMinimapBaker,
  type MinimapBakeReply,
  type MinimapBakeRequest,
  type MinimapBakeWorker,
  minimapBakeScene,
} from '../src/hud/minimap/bake.js';

const SIZE = 2;
const TERRAIN: SceneTerrain = { width: SIZE, height: SIZE, typeIds: [0, 0, 0, 0] };
const SCENE = minimapBakeScene(TERRAIN, () => 0);

/** A worker stand-in: records what the client posts and lets the test answer or fail. */
function fakeWorker() {
  const posted: MinimapBakeRequest[] = [];
  let onMessage: ((event: MessageEvent<MinimapBakeReply>) => void) | undefined;
  let onError: ((event: ErrorEvent) => void) | undefined;
  let terminated = false;
  function addEventListener(type: 'message', listener: (event: MessageEvent<MinimapBakeReply>) => void): void;
  function addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  function addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<MinimapBakeReply>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') onMessage = listener as (event: MessageEvent<MinimapBakeReply>) => void;
    else onError = listener as (event: ErrorEvent) => void;
  }
  const worker: MinimapBakeWorker = {
    addEventListener,
    postMessage: (request) => posted.push(request),
    terminate: () => {
      terminated = true;
    },
  };
  return {
    worker,
    posted,
    terminated: () => terminated,
    reply: (id: number, rgba: Uint8Array) =>
      onMessage?.({ data: { id, rgba } } as MessageEvent<MinimapBakeReply>),
    fail: (message: string) => onError?.({ message } as ErrorEvent),
  };
}

const bakeIds = (posted: readonly MinimapBakeRequest[]): number[] =>
  posted.flatMap((request) => (request.kind === 'bake' ? [request.id] : []));

describe('worker minimap baker', () => {
  it('posts the scene first and settles each bake by its id', async () => {
    const fake = fakeWorker();
    const baker = createWorkerMinimapBaker(SCENE, () => fake.worker);
    const first = baker.bake(1, 1, 'natural');
    const second = baker.bake(2, 2, 'dark');
    expect(fake.posted[0]).toEqual({ kind: 'scene', scene: SCENE });
    expect(fake.posted.slice(1)).toMatchObject([
      { kind: 'bake', width: 1, height: 1, mode: 'natural' },
      { kind: 'bake', width: 2, height: 2, mode: 'dark' },
    ]);
    const [firstId = -1, secondId = -1] = bakeIds(fake.posted);
    const secondPixels = new Uint8Array([2]);
    const firstPixels = new Uint8Array([1]);
    fake.reply(secondId, secondPixels);
    fake.reply(firstId, firstPixels);
    await expect(first).resolves.toBe(firstPixels);
    await expect(second).resolves.toBe(secondPixels);
  });

  it('rejects a pending bake on dispose and terminates the worker', async () => {
    const fake = fakeWorker();
    const baker = createWorkerMinimapBaker(SCENE, () => fake.worker);
    const pending = baker.bake(1, 1, 'natural');
    baker.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(fake.terminated()).toBe(true);
  });

  it('fails for good on a worker error, even with nothing pending', async () => {
    const fake = fakeWorker();
    const baker = createWorkerMinimapBaker(SCENE, () => fake.worker);
    const pending = baker.bake(1, 1, 'natural');
    fake.fail('boom');
    await expect(pending).rejects.toThrow('boom');

    const idle = fakeWorker();
    const idleBaker = createWorkerMinimapBaker(SCENE, () => idle.worker);
    idle.fail('script failed');
    await expect(idleBaker.bake(1, 1, 'natural')).rejects.toThrow('script failed');
    expect(bakeIds(idle.posted)).toEqual([]);
    expect(idle.terminated()).toBe(true);
  });
});

describe('cached minimap bake', () => {
  /** A rasterizer whose pixels name the call that drew them, counting its calls. */
  function countingRasterizer() {
    const calls: { width: number; height: number; objects: MinimapObjects | undefined }[] = [];
    const rasterize = (width: number, height: number, objects?: MinimapObjects): Uint8Array => {
      calls.push({ width, height, objects });
      return new Uint8Array(width * height * 4).fill(40 + calls.length * 20);
    };
    return { rasterize, calls };
  }
  const NO_OBJECTS: MinimapObjects = { types: [], placements: [] };

  it('grades the kept natural raster again when only the mode changes', () => {
    const { rasterize, calls } = countingRasterizer();
    const bake = createCachedMinimapBake(rasterize);
    const natural = bake(3, 2, 'natural', NO_OBJECTS);
    const dark = bake(3, 2, 'dark');
    const hidden = bake(3, 2, 'hidden');
    expect(calls).toHaveLength(1);
    expect(dark).toEqual(applyMinimapGroundMode(natural.slice(), 'dark'));
    expect(hidden).toEqual(applyMinimapGroundMode(natural.slice(), 'hidden'));
    // Each answer is its own buffer, so a transfer of one leaves the kept raster whole.
    expect(new Set([natural.buffer, dark.buffer, hidden.buffer]).size).toBe(3);
    expect(bake(3, 2, 'natural')).toEqual(natural);
    expect(calls).toHaveLength(1);
  });

  it('rasterizes again for a new size or new objects', () => {
    const { rasterize, calls } = countingRasterizer();
    const bake = createCachedMinimapBake(rasterize);
    bake(3, 2, 'muted');
    bake(4, 2, 'muted');
    bake(4, 2, 'muted', NO_OBJECTS);
    bake(4, 2, 'dark');
    expect(calls.map(({ width, objects }) => [width, objects])).toEqual([
      [3, undefined],
      [4, undefined],
      [4, NO_OBJECTS],
    ]);
  });
});
