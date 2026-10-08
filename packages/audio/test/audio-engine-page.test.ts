import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_FADE_S,
  CLOCK_STALL_MS,
  DEFAULT_VOLUMES,
  volumeGain,
  WebAudioEngine,
} from '../src/index.js';
import { FakeContext } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';

/**
 * The engine's page-facing hooks: the preload that waits for the context, the background silence and
 * the stalled-clock check.
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

describe('WebAudioEngine background silence', () => {
  it('fades the master to silence in the background and back, without stopping the music or beds', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const { master } = mixerGraph(ctx);
    engine.setPlayInBackground(false);
    engine.setPageInBackground(true);
    expect(master.gain.ramps.at(-1)).toEqual({ value: 0, time: BACKGROUND_FADE_S });
    expect(engine.audible).toBe(true);
    engine.setPageInBackground(false);
    expect(master.gain.ramps.at(-1)).toEqual({
      value: volumeGain(DEFAULT_VOLUMES.master),
      time: BACKGROUND_FADE_S,
    });
  });

  it('keeps sounding in the background while the player wants sound there', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setPageInBackground(true);
    expect(mixerGraph(ctx).master.gain.value).toBe(volumeGain(DEFAULT_VOLUMES.master));
    engine.setPlayInBackground(false);
    expect(mixerGraph(ctx).master.gain.value).toBe(0);
  });

  it('keeps a slider move silent while in the background', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setPlayInBackground(false);
    engine.setPageInBackground(true);
    engine.setVolumes({ ...DEFAULT_VOLUMES, master: DEFAULT_VOLUMES.master / 2 });
    expect(mixerGraph(ctx).master.gain.ramps.at(-1)?.value).toBe(0);
  });

  it('starts a context created in the background silent', async () => {
    const { engine, ctx } = makeEngine();
    engine.setPlayInBackground(false);
    engine.setPageInBackground(true);
    await engine.resume();
    expect(mixerGraph(ctx).master.gain.value).toBe(0);
  });
});

describe('WebAudioEngine clock health', () => {
  it('counts a running context whose clock stood still as paused and restarts it on resume', async () => {
    const { engine, ctx, clock } = makeEngine();
    await engine.resume();
    expect(engine.started).toBe(true);
    clock.ms += CLOCK_STALL_MS;
    expect(engine.started).toBe(false);
    await engine.resume();
    expect(ctx.suspends).toBe(1);
    expect(ctx.state).toBe('running');
  });

  it('keeps a moving clock started however long between checks', async () => {
    const { engine, ctx, clock } = makeEngine();
    await engine.resume();
    expect(engine.started).toBe(true);
    clock.ms += CLOCK_STALL_MS * 10;
    ctx.currentTime += 1;
    expect(engine.started).toBe(true);
  });

  it('reports an interrupted context as paused', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    ctx.refuseResume = true;
    ctx.setState('interrupted' as AudioContextState);
    expect(engine.started).toBe(false);
  });
});
