import { describe, expect, it } from 'vitest';
import type { OneShot } from '../src/index.js';
import {
  AMBIENT_FADE_S,
  DEFAULT_MASTER_GAIN,
  DEFAULT_SFX_VOLUME,
  ONE_SHOT_COOLDOWN_S,
  WebAudioEngine,
} from '../src/index.js';
import { FakeContext, FakeGain, type FakePanner, type FakeSource, flush } from './helpers/fake-audio.js';

/**
 * The Web Audio engine, exercised through its injected platform seams (a fake context + a stub
 * loader + a scripted random): the one-shot gain/pan graph, the cooldown debounce, the memoised
 * failed load, the ambient start/retune/stop reconciliation and the in-flight-load races (mute,
 * departed bed) - all without a browser.
 */

interface Harness {
  readonly engine: WebAudioEngine;
  readonly ctx: FakeContext;
  readonly fetched: string[];
}

function makeEngine(opts: { failFetch?: boolean; noPanner?: boolean; random?: () => number } = {}): Harness {
  const ctx = new FakeContext();
  if (opts.noPanner) {
    (ctx as { createStereoPanner?: unknown }).createStereoPanner = undefined;
  }
  const fetched: string[] = [];
  const engine = new WebAudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => {
      fetched.push(url);
      if (opts.failFetch) throw new Error('missing wav');
      return new ArrayBuffer(4);
    },
    random: opts.random ?? (() => 0),
  });
  return { engine, ctx, fetched };
}

const shot = (over: Partial<OneShot> = {}): OneShot => ({
  files: ['sfx/hammer.wav'],
  gain: 0.42,
  pan: -0.3,
  key: 'test:1',
  ...over,
});

describe('WebAudioEngine one-shots', () => {
  it('plays a one-shot through a pan+gain graph into the sfx bus', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    expect(engine.started).toBe(true);
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    expect(fetched).toEqual(['/sounds/sfx/hammer.wav']);
    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0] as FakeSource;
    expect(source.started).toBe(true);
    // source → panner (pan applied) → gain (shot gain) → sfx bus → master → destination.
    const panner = source.connectedTo[0] as FakePanner;
    expect(panner.pan.value).toBeCloseTo(-0.3, 5);
    const gain = panner.connectedTo[0] as FakeGain;
    expect(gain.gain.value).toBeCloseTo(0.42, 5);
    const [master, sfxBus] = ctx.gains as [FakeGain, FakeGain];
    expect(gain.connectedTo[0]).toBe(sfxBus);
    expect(sfxBus.gain.value).toBeCloseTo(DEFAULT_SFX_VOLUME, 5);
    expect(sfxBus.connectedTo[0]).toBe(master);
    expect(master.gain.value).toBeCloseTo(DEFAULT_MASTER_GAIN, 5);
    expect(master.connectedTo[0]).toBe(ctx.destination);
  });

  it('debounces an identical key within the cooldown and replays it after', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot()], ambient: [] });
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    expect(ctx.sources).toHaveLength(1);
    ctx.currentTime += ONE_SHOT_COOLDOWN_S + 0.01;
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    expect(ctx.sources).toHaveLength(2);
  });

  it('holds a wav-exclusive shot while its own wav still sounds, and lets a plain one layer', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    // The fake decodes a 4-byte buffer as a 4-second wav.
    engine.apply({ oneShots: [shot({ key: 'voice:a', exclusive: 'wav' })], ambient: [] });
    await flush();
    ctx.currentTime += ONE_SHOT_COOLDOWN_S + 0.01; // past the key cooldown, inside the wav
    engine.apply({ oneShots: [shot({ key: 'voice:b', exclusive: 'wav' })], ambient: [] }); // same wav, other key
    await flush();
    expect(ctx.sources).toHaveLength(1); // that line is still sounding: skipped
    engine.apply({ oneShots: [shot({ key: 'thud:1' })], ambient: [] }); // not exclusive: layers over it
    await flush();
    expect(ctx.sources).toHaveLength(2);
    ctx.currentTime += 4; // the line has ended
    engine.apply({ oneShots: [shot({ key: 'voice:c', exclusive: 'wav' })], ambient: [] });
    await flush();
    expect(ctx.sources).toHaveLength(3);
  });

  it('holds a group-exclusive shot while any wav of its pool still sounds', async () => {
    // Random 0 picks the first wav; the second ask picks a different one, and a wav-exclusive shot would
    // let it through, while an order's answer waits for the whole pool.
    let pick = 0;
    const { engine, ctx } = makeEngine({ random: () => pick });
    await engine.resume();
    const pool = ['voice/ok1.wav', 'voice/ok2.wav'];
    engine.apply({ oneShots: [shot({ files: pool, key: 'respond:a', exclusive: 'group' })], ambient: [] });
    await flush();
    pick = 0.99;
    ctx.currentTime += ONE_SHOT_COOLDOWN_S + 0.01;
    engine.apply({ oneShots: [shot({ files: pool, key: 'respond:b', exclusive: 'group' })], ambient: [] });
    engine.apply({ oneShots: [shot({ files: pool, key: 'scream:b', exclusive: 'wav' })], ambient: [] });
    await flush();
    expect(ctx.sources).toHaveLength(2); // the pool held the answer; the other wav was free for the scream
  });

  it('releases an exclusive reservation whose load landed while muted, so the wav can sound later', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot({ key: 'voice:a', exclusive: 'wav' })], ambient: [] }); // reserved, loading
    engine.setEnabled(false); // mute lands before the wav arrives
    await flush();
    expect(ctx.sources).toHaveLength(0);
    engine.setEnabled(true);
    ctx.currentTime += ONE_SHOT_COOLDOWN_S + 0.01;
    engine.apply({ oneShots: [shot({ key: 'voice:b', exclusive: 'wav' })], ambient: [] }); // the same wav
    await flush();
    expect(ctx.sources).toHaveLength(1); // not held by the abandoned reservation
  });

  it('lets a yielded exclusive shot leave its key cooldown untouched', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot({ key: 'respond:a', exclusive: 'wav' })], ambient: [] }); // sounds for 4 s
    await flush();
    ctx.currentTime = 4 - ONE_SHOT_COOLDOWN_S / 2;
    engine.apply({ oneShots: [shot({ key: 'respond:b', exclusive: 'wav' })], ambient: [] }); // held: still sounding
    ctx.currentTime = 4 + ONE_SHOT_COOLDOWN_S / 2; // the line has ended, within a cooldown of the yielded ask
    engine.apply({ oneShots: [shot({ key: 'respond:b', exclusive: 'wav' })], ambient: [] });
    await flush();
    expect(ctx.sources).toHaveLength(2); // the yielded ask started no cooldown
  });

  it('memoises a failed load and never re-fetches the missing wav', async () => {
    const { engine, ctx, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    ctx.currentTime += ONE_SHOT_COOLDOWN_S + 0.01;
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    expect(fetched).toHaveLength(1); // second play hit the cached failure
    expect(ctx.sources).toHaveLength(0); // and nothing ever sounded
  });

  it('picks the wav from the group via the injected random source', async () => {
    const { engine, fetched } = makeEngine({ random: () => 0.99 });
    await engine.resume();
    engine.apply({ oneShots: [shot({ files: ['a.wav', 'b.wav', 'c.wav'] })], ambient: [] });
    await flush();
    expect(fetched).toEqual(['/sounds/c.wav']); // 0.99 → last of three
  });

  it('degrades to unpanned playback when the context has no StereoPannerNode', async () => {
    const { engine, ctx } = makeEngine({ noPanner: true });
    await engine.resume();
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    const source = ctx.sources[0] as FakeSource;
    expect(source.started).toBe(true);
    expect(source.connectedTo[0]).toBeInstanceOf(FakeGain); // straight into the shot gain, no panner
  });

  it('stays a silent no-op before a gesture resumes the context', async () => {
    const { engine, ctx, fetched } = makeEngine();
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    expect(fetched).toHaveLength(0);
    expect(ctx.sources).toHaveLength(0);
    expect(engine.started).toBe(false);
    expect(engine.audible).toBe(false);
  });
});

describe('WebAudioEngine context interruption', () => {
  it('asks for a context the browser suspended after it ran back at once', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    ctx.setState('suspended'); // a phone call, OS sleep or an idle-tab suspension
    await flush();
    expect(ctx.resumes).toBe(2);
    expect(engine.audible).toBe(true);
  });

  it('restarts the music a suspension dropped once the context runs again', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    ctx.refuseResume = true; // no activation: the engine's own resume is refused
    engine.setMusic({ file: 'theme.ogg' });
    ctx.setState('suspended'); // before the track's load lands
    await flush();
    expect(ctx.sources).toHaveLength(0);
    ctx.setState('running'); // the interruption ends and the platform resumes the context
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('never resumes a context after the engine closed it', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.close();
    await flush();
    expect(ctx.state).toBe('closed');
    expect(ctx.resumes).toBe(1);
  });
});

describe('WebAudioEngine ambient reconciliation', () => {
  const bed = (gain: number) => ({ name: 'Meadow Green', file: 'ambient/meadow1.wav', gain });

  it('starts a new bed as a loop fading in from silence to its target gain', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] });
    await flush();
    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0] as FakeSource;
    expect(source.loop).toBe(true);
    expect(source.started).toBe(true);
    const gain = source.connectedTo[0] as FakeGain;
    expect(gain.gain.ramps).toEqual([{ value: 0.4, time: AMBIENT_FADE_S }]); // from the 0 start
  });

  it('retunes a running bed by ramping its gain, without a second source', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] });
    await flush();
    engine.apply({ oneShots: [], ambient: [bed(0.2)] });
    await flush();
    expect(ctx.sources).toHaveLength(1);
    const gain = (ctx.sources[0] as FakeSource).connectedTo[0] as FakeGain;
    expect(gain.gain.ramps.at(-1)?.value).toBeCloseTo(0.2, 5);
  });

  it('lets a fade run out while its bed keeps the same gain frame after frame', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] });
    await flush();
    for (let frame = 1; frame <= 5; frame++) {
      ctx.currentTime = frame / 60;
      engine.apply({ oneShots: [], ambient: [bed(0.4)] });
    }
    const gain = (ctx.sources[0] as FakeSource).connectedTo[0] as FakeGain;
    expect(gain.gain.ramps).toEqual([{ value: 0.4, time: AMBIENT_FADE_S }]);
  });

  it('starts a still-loading bed at the CURRENT target gain, not the stale requested one', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] }); // load in flight
    engine.apply({ oneShots: [], ambient: [bed(0.1)] }); // retuned before the wav arrived
    await flush();
    expect(ctx.sources).toHaveLength(1);
    const gain = (ctx.sources[0] as FakeSource).connectedTo[0] as FakeGain;
    expect(gain.gain.ramps.at(-1)?.value).toBeCloseTo(0.1, 5);
  });

  it('fades out and stops a bed that left the target set', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] });
    await flush();
    ctx.currentTime = 3;
    engine.apply({ oneShots: [], ambient: [] });
    await flush();
    const source = ctx.sources[0] as FakeSource;
    expect(source.stoppedAt).toBeCloseTo(3 + AMBIENT_FADE_S, 5);
    const gain = source.connectedTo[0] as FakeGain;
    expect(gain.gain.ramps.at(-1)?.value).toBe(0);
  });

  it('never starts a bed whose load was still in flight when the engine was muted', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] }); // load kicked off, promise pending
    engine.setEnabled(false); // mute lands before the wav arrives
    await flush();
    expect(ctx.sources).toHaveLength(0); // the loop must not start audibly under mute
  });

  it('never starts a bed that left the target set while its load was still in flight', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] }); // load kicked off, promise pending
    engine.apply({ oneShots: [], ambient: [] }); // terrain scrolled off before the wav arrived
    await flush();
    expect(ctx.sources).toHaveLength(0); // the departed bed must not start and linger
  });
});
