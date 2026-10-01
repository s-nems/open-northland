import type { SceneTerrain } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
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
    const first = baker.bake(1, 1);
    const second = baker.bake(2, 2);
    expect(fake.posted[0]).toEqual({ kind: 'scene', scene: SCENE });
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
    const pending = baker.bake(1, 1);
    baker.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(fake.terminated()).toBe(true);
  });

  it('fails for good on a worker error, even with nothing pending', async () => {
    const fake = fakeWorker();
    const baker = createWorkerMinimapBaker(SCENE, () => fake.worker);
    const pending = baker.bake(1, 1);
    fake.fail('boom');
    await expect(pending).rejects.toThrow('boom');

    const idle = fakeWorker();
    const idleBaker = createWorkerMinimapBaker(SCENE, () => idle.worker);
    idle.fail('script failed');
    await expect(idleBaker.bake(1, 1)).rejects.toThrow('script failed');
    expect(bakeIds(idle.posted)).toEqual([]);
    expect(idle.terminated()).toBe(true);
  });
});
