import { describe, expect, it } from 'vitest';
import { WebAudioEngine } from '../src/index.js';
import { FakeContext } from './helpers/fake-audio.js';

/**
 * The engine's page-facing hooks: the preload that waits for the context.
 */

function makeEngine(): {
  engine: WebAudioEngine;
  ctx: FakeContext;
  fetched: string[];
  clock: { ms: number };
} {
  const ctx = new FakeContext();
  const fetched: string[] = [];
  const clock = { ms: 0 };
  const engine = new WebAudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => {
      fetched.push(url);
      return new ArrayBuffer(4);
    },
    now: () => clock.ms,
  });
  return { engine, ctx, fetched, clock };
}

describe('WebAudioEngine preload', () => {
  it('waits for the context a gesture creates before fetching anything', async () => {
    const { engine, fetched } = makeEngine();
    const done = engine.preload([{ file: 'gui/click.wav', pinned: true }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetched).toEqual([]);
    await engine.resume();
    const report = await done;
    expect(fetched).toEqual(['/sounds/gui/click.wav']);
    expect(report?.decoded).toBe(1);
  });

  it('settles null when the engine closes before audio ever starts', async () => {
    const { engine } = makeEngine();
    const done = engine.preload([{ file: 'gui/click.wav', pinned: true }]);
    engine.close();
    expect(await done).toBeNull();
  });

  it('settles null on a platform with no Web Audio', async () => {
    const engine = new WebAudioEngine({ createContext: () => null });
    const done = engine.preload([{ file: 'gui/click.wav', pinned: true }]);
    await engine.resume();
    expect(await done).toBeNull();
  });
});
