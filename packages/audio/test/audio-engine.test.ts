import { describe, expect, it } from 'vitest';
import type { OneShot } from '../src/index.js';
import {
  AMBIENT_FADE_S,
  CLICK_FREE_RAMP_S,
  CLOSE_GRACE_S,
  DEFAULT_VOLUMES,
  FAR_ZOOM_SCALE,
  LIMITER_ATTACK_S,
  LIMITER_KNEE_DB,
  LIMITER_RATIO,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  MUFFLE_FAR_HZ,
  MUFFLE_OPEN_HZ,
  MUFFLE_Q_DB,
  PERSPECTIVE_RAMP_S,
  perspectiveGain,
  VOLUME_RAMP_S,
  volumeGain,
  WebAudioEngine,
  zoomDistance,
} from '../src/index.js';
import {
  FakeBiquad,
  FakeCompressor,
  FakeContext,
  FakeGain,
  type FakePanner,
  type FakeSource,
  flush,
} from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';

/**
 * The Web Audio engine, exercised through its injected platform seams (a fake context + a stub
 * loader): the one-shot gain/pan graph, stopping a stolen shot, the memoised failed load, the ambient
 * start/retune/stop reconciliation and the in-flight-load races (mute, departed bed) - all without a
 * browser.
 */

interface Harness {
  readonly engine: WebAudioEngine;
  readonly ctx: FakeContext;
  readonly fetched: string[];
}

function makeEngine(
  opts: { failFetch?: boolean; noPanner?: boolean; random?: () => number } = {},
): Harness {
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
    ...(opts.random !== undefined ? { random: opts.random } : {}),
  });
  return { engine, ctx, fetched };
}

/** The birth jingle's `MusicType`; any jingle routes alike. */
const BIRTH_JINGLE = 23;

const waitForClose = (): Promise<unknown> => new Promise((r) => setTimeout(r, CLOSE_GRACE_S * 1000 + 10));

const shot = (over: Partial<OneShot> = {}): OneShot => ({
  files: ['sfx/hammer.wav'],
  gain: 0.42,
  pan: -0.3,
  key: 'test:1',
  ...over,
});

describe('WebAudioEngine one-shots', () => {
  it('plays a one-shot through a pan+gain graph into its bus', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    expect(engine.started).toBe(true);
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    expect(fetched).toEqual(['/sounds/sfx/hammer.wav']);
    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0] as FakeSource;
    expect(source.started).toBe(true);
    // source → panner (pan applied) → gain (shot gain) → ui bus (no lane) → master → limiter → out.
    const panner = source.connectedTo[0] as FakePanner;
    expect(panner.pan.value).toBeCloseTo(-0.3, 5);
    const gain = panner.connectedTo[0] as FakeGain;
    expect(gain.gain.value).toBeCloseTo(0.42, 5);
    const { master, buses } = mixerGraph(ctx);
    expect(gain.connectedTo[0]).toBe(buses.ui);
    expect(buses.ui.gain.value).toBeCloseTo(volumeGain(DEFAULT_VOLUMES.ui), 5);
    expect(buses.ui.connectedTo[0]).toBe(master);
    expect(master.gain.value).toBeCloseTo(volumeGain(DEFAULT_VOLUMES.master), 5);
    const limiter = master.connectedTo[0] as FakeCompressor;
    expect(limiter).toBeInstanceOf(FakeCompressor);
    expect(limiter.connectedTo[0]).toBe(ctx.destination);
  });

  it('routes each one-shot to the bus of its lane, through its zoom layer on a world bus', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({
      oneShots: [
        shot({ key: 'work', files: ['work.wav'], lane: { kind: 'sfx' } }),
        shot({ key: 'chatter', files: ['talk.wav'], lane: { kind: 'voice' } }),
        shot({ key: 'birth', files: ['birth.wav'], lane: { kind: 'jingle', musicType: BIRTH_JINGLE } }),
        shot({ key: 'blow', files: ['blow.wav'], lane: { kind: 'sfx' }, layer: 'impact' }),
        shot({ key: 'scream', files: ['scream.wav'], lane: { kind: 'voice' }, layer: 'impact' }),
      ],
      ambient: [],
    });
    await flush();
    const { buses, layers } = mixerGraph(ctx);
    const entryOf = (source: FakeSource): unknown =>
      ((source.connectedTo[0] as FakePanner).connectedTo[0] as FakeGain).connectedTo[0];
    const [work, chatter, birth, blow, scream] = ctx.sources as [
      FakeSource,
      FakeSource,
      FakeSource,
      FakeSource,
      FakeSource,
    ];
    expect(entryOf(work)).toBe(layers.world.detail);
    expect(entryOf(chatter)).toBe(layers.voice.detail);
    expect(entryOf(birth)).toBe(buses.ui);
    expect(entryOf(blow)).toBe(layers.world.impact);
    expect(entryOf(scream)).toBe(layers.voice.impact);
    // Detail reaches its bus through the zoom low-pass; impacts and beds go straight in.
    const worldMuffle = layers.world.detail.connectedTo[0] as FakeBiquad;
    const voiceMuffle = layers.voice.detail.connectedTo[0] as FakeBiquad;
    expect(worldMuffle).toBeInstanceOf(FakeBiquad);
    expect(worldMuffle.type).toBe('lowpass');
    expect(worldMuffle.connectedTo[0]).toBe(buses.world);
    expect(voiceMuffle.connectedTo[0]).toBe(buses.voice);
    expect(layers.world.impact.connectedTo[0]).toBe(buses.world);
    expect(layers.voice.impact.connectedTo[0]).toBe(buses.voice);
    expect(layers.bed.connectedTo[0]).toBe(buses.ambient);
  });

  it('ends the master in a peak limiter, not the default compressor', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const limiter = ctx.created.find((n) => n instanceof FakeCompressor) as FakeCompressor;
    expect(limiter.threshold.value).toBe(LIMITER_THRESHOLD_DB);
    expect(limiter.knee.value).toBe(LIMITER_KNEE_DB);
    expect(limiter.ratio.value).toBe(LIMITER_RATIO);
    expect(limiter.attack.value).toBe(LIMITER_ATTACK_S);
    expect(limiter.release.value).toBe(LIMITER_RELEASE_S);
  });

  it('fades the master out on mute and back to its slider on unmute', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const { master } = mixerGraph(ctx);
    ctx.currentTime = 2;
    engine.setEnabled(false);
    expect(master.gain.ramps.at(-1)).toEqual({ value: 0, time: 2 + CLICK_FREE_RAMP_S });
    engine.setVolumes({ ...DEFAULT_VOLUMES, master: 50 }); // a slider moved while muted stays silent
    expect(master.gain.ramps.at(-1)?.value).toBe(0);
    engine.setEnabled(true);
    expect(master.gain.ramps.at(-1)?.value).toBeCloseTo(volumeGain(50), 5);
  });

  it('ramps only the moved sliders, from the level they hold', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const { master, buses } = mixerGraph(ctx);
    ctx.currentTime = 1;
    engine.setVolumes({ ...DEFAULT_VOLUMES, world: 40, ambient: 0 });
    expect(buses.world.gain.events.slice(-2)).toEqual([
      { kind: 'set', value: volumeGain(DEFAULT_VOLUMES.world), time: 1 },
      { kind: 'ramp', value: volumeGain(40), time: 1 + VOLUME_RAMP_S },
    ]);
    expect(buses.ambient.gain.ramps.at(-1)?.value).toBe(0);
    expect(master.gain.ramps).toEqual([]);
    expect(buses.voice.gain.ramps).toEqual([]);
  });

  it('applies slider positions given before the context exists, clamped to the slider range', async () => {
    const { engine, ctx } = makeEngine();
    engine.setVolumes({ ...DEFAULT_VOLUMES, voice: 150, ui: -5 });
    await engine.resume();
    const { buses } = mixerGraph(ctx);
    expect(buses.voice.gain.value).toBe(1);
    expect(buses.ui.gain.value).toBe(0);
  });

  it('memoises a failed load and never re-fetches the missing wav', async () => {
    const { engine, ctx, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    expect(fetched).toHaveLength(1); // second play hit the cached failure
    expect(ctx.sources).toHaveLength(0); // and nothing ever sounded
  });

  it('plays every shot it is handed on its first wav, leaving cooldowns and picks to the arbiter', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot({ exclusive: 'wav' }), shot({ exclusive: 'wav' })], ambient: [] });
    engine.apply({ oneShots: [shot({ files: ['a.wav', 'b.wav'] })], ambient: [] });
    await flush();
    expect(ctx.sources).toHaveLength(3);
    expect(fetched).toEqual(['/sounds/sfx/hammer.wav', '/sounds/a.wav']);
  });

  it('plays a shot at the rate the arbiter gave it, and at the recorded rate without one', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot({ rate: 1.03 }), shot({ key: 'plain' })], ambient: [] });
    await flush();
    expect((ctx.sources[0] as FakeSource).playbackRate.value).toBe(1.03);
    expect((ctx.sources[1] as FakeSource).playbackRate.events).toHaveLength(0);
  });

  it('fades a stopped world shot to silence and stops its source once the fade lands', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot({ instance: 7 })], ambient: [] });
    await flush();
    ctx.currentTime = 2;
    engine.stopOneShot(7);
    const source = ctx.sources[0] as FakeSource;
    const gain = (source.connectedTo[0] as FakePanner).connectedTo[0] as FakeGain;
    expect(gain.gain.ramps).toEqual([{ value: 0, time: 2 + CLICK_FREE_RAMP_S }]);
    expect(source.stoppedAt).toBe(2 + CLICK_FREE_RAMP_S);
  });

  it('never starts a world shot stopped while its wav still loads', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot({ instance: 7 })], ambient: [] });
    engine.stopOneShot(7);
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });

  it('forgets a world shot once its source ends, so a late stop touches nothing', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot({ instance: 7 })], ambient: [] });
    await flush();
    const source = ctx.sources[0] as FakeSource;
    source.onended?.(); // played out
    engine.stopOneShot(7);
    expect(source.stoppedAt).toBeNull();
  });

  it('reports a wav`s decoded length once it has loaded', async () => {
    const { engine } = makeEngine();
    await engine.resume();
    expect(engine.clipLengthS('sfx/hammer.wav')).toBeUndefined();
    engine.apply({ oneShots: [shot()], ambient: [] });
    expect(engine.clipLengthS('sfx/hammer.wav')).toBeUndefined(); // still loading
    await flush();
    expect(engine.clipLengthS('sfx/hammer.wav')).toBe(4); // the fake decodes 4 bytes as 4 s
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

  it('fades the master out before it closes the context, and never resumes it after', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.close();
    expect(mixerGraph(ctx).master.gain.ramps.at(-1)).toEqual({ value: 0, time: CLICK_FREE_RAMP_S });
    expect(ctx.state).toBe('running'); // the fade first
    expect(engine.audible).toBe(false);
    await waitForClose();
    expect(ctx.state).toBe('closed');
    expect(ctx.resumes).toBe(1);
  });
});

describe('WebAudioEngine ambient reconciliation', () => {
  const bed = (gain: number, pan = 0) => ({ name: 'Meadow Green', file: 'ambient/meadow1.wav', gain, pan });
  /** A running bed's gain, behind its panner. */
  const bedGain = (source: FakeSource): FakeGain =>
    (source.connectedTo[0] as FakePanner).connectedTo[0] as FakeGain;

  it('starts a new bed as a loop fading in from silence to its target gain', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] });
    await flush();
    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0] as FakeSource;
    expect(source.loop).toBe(true);
    expect(source.started).toBe(true);
    const gain = bedGain(source);
    expect(gain.gain.ramps).toEqual([{ value: 0.4, time: AMBIENT_FADE_S }]); // from the 0 start
  });

  it('starts a bed at a random point of its loop', async () => {
    const LOOP_SHARE = 0.25;
    const { engine, ctx } = makeEngine({ random: () => LOOP_SHARE });
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] });
    await flush();
    const source = ctx.sources[0] as FakeSource;
    expect(source.startOffset).toBe(LOOP_SHARE * (source.buffer as { duration: number }).duration);
    expect(source.startOffset).toBeGreaterThan(0);
  });

  it('retunes a running bed by ramping its gain, without a second source', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] });
    await flush();
    engine.apply({ oneShots: [], ambient: [bed(0.2)] });
    await flush();
    expect(ctx.sources).toHaveLength(1);
    const gain = bedGain(ctx.sources[0] as FakeSource);
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
    const gain = bedGain(ctx.sources[0] as FakeSource);
    expect(gain.gain.ramps).toEqual([{ value: 0.4, time: AMBIENT_FADE_S }]);
  });

  it('starts a still-loading bed at the CURRENT target gain, not the stale requested one', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4)] }); // load in flight
    engine.apply({ oneShots: [], ambient: [bed(0.1)] }); // retuned before the wav arrived
    await flush();
    expect(ctx.sources).toHaveLength(1);
    const gain = bedGain(ctx.sources[0] as FakeSource);
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
    const gain = bedGain(source);
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

  it('starts a bed at its pan and glides it toward a moved one', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4, -0.5)] });
    await flush();
    const panner = (ctx.sources[0] as FakeSource).connectedTo[0] as FakePanner;
    expect(panner.pan.value).toBe(-0.5);
    expect(panner.pan.ramps).toEqual([]);
    ctx.currentTime = 2;
    engine.apply({ oneShots: [], ambient: [bed(0.4, 0.3)] });
    engine.apply({ oneShots: [], ambient: [bed(0.4, 0.3)] }); // an unchanged pan does not restart it
    expect(panner.pan.ramps).toEqual([{ value: 0.3, time: 2 + AMBIENT_FADE_S }]);
  });

  it('plays a bed centred where the context has no stereo panner', async () => {
    const { engine, ctx } = makeEngine({ noPanner: true });
    await engine.resume();
    engine.apply({ oneShots: [], ambient: [bed(0.4, -0.5)] });
    await flush();
    engine.apply({ oneShots: [], ambient: [bed(0.4, 0.5)] });
    const gain = (ctx.sources[0] as FakeSource).connectedTo[0] as FakeGain;
    expect(gain).toBeInstanceOf(FakeGain);
    expect(gain.connectedTo[0]).toBe(mixerGraph(ctx).layers.bed);
  });
});

describe('WebAudioEngine zoom perspective', () => {
  const allRamps = (ctx: FakeContext): number => ctx.gains.reduce((sum, g) => sum + g.gain.ramps.length, 0);

  it('ramps each zoom layer once when the camera zooms out, leaving music and ui alone', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const { buses, layers } = mixerGraph(ctx);
    ctx.currentTime = 1;
    engine.setCameraScale(FAR_ZOOM_SCALE);
    const far = zoomDistance(FAR_ZOOM_SCALE);
    for (const node of [layers.world.detail, layers.voice.detail]) {
      expect(node.gain.ramps).toEqual([
        { value: perspectiveGain('detail', far), time: 1 + PERSPECTIVE_RAMP_S },
      ]);
    }
    for (const node of [layers.world.impact, layers.voice.impact]) {
      expect(node.gain.ramps).toEqual([
        { value: perspectiveGain('impact', far), time: 1 + PERSPECTIVE_RAMP_S },
      ]);
    }
    expect(layers.bed.gain.ramps).toEqual([
      { value: perspectiveGain('bed', far), time: 1 + PERSPECTIVE_RAMP_S },
    ]);
    for (const bus of [buses.music, buses.ui, buses.world, buses.voice, buses.ambient]) {
      expect(bus.gain.ramps).toEqual([]);
    }
  });

  it('closes the detail low-pass as the camera zooms out and opens it again at 1:1', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const filters = ctx.created.filter((n): n is FakeBiquad => n instanceof FakeBiquad);
    expect(filters).toHaveLength(2); // one per world bus, never one per sound
    for (const filter of filters) {
      expect(filter.frequency.value).toBe(MUFFLE_OPEN_HZ);
      expect(filter.Q.value).toBe(MUFFLE_Q_DB);
    }
    ctx.currentTime = 1;
    engine.setCameraScale(FAR_ZOOM_SCALE);
    for (const filter of filters) {
      expect(filter.frequency.ramps.at(-1)?.value).toBeCloseTo(MUFFLE_FAR_HZ, 6);
      expect(filter.frequency.ramps.at(-1)?.time).toBeCloseTo(1 + PERSPECTIVE_RAMP_S, 9);
    }
    engine.setCameraScale(1);
    for (const filter of filters) expect(filter.frequency.ramps.at(-1)?.value).toBeCloseTo(MUFFLE_OPEN_HZ, 6);
  });

  it('schedules nothing for an unchanged zoom or for a camera closer than 1:1', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setCameraScale(1);
    engine.setCameraScale(2);
    engine.setCameraScale(undefined);
    expect(allRamps(ctx)).toBe(0);
    engine.setCameraScale(0.5);
    const once = allRamps(ctx);
    engine.setCameraScale(0.5);
    expect(allRamps(ctx)).toBe(once);
  });

  it('builds the layers at a zoom set before the context exists', async () => {
    const { engine, ctx } = makeEngine();
    engine.setCameraScale(FAR_ZOOM_SCALE);
    await engine.resume();
    const { layers } = mixerGraph(ctx);
    const far = zoomDistance(FAR_ZOOM_SCALE);
    expect(layers.world.detail.gain.value).toBeCloseTo(perspectiveGain('detail', far), 9);
    expect(layers.bed.gain.value).toBeCloseTo(perspectiveGain('bed', far), 9);
  });

  it('leaves a playing shot at its screen-position gain while the zoom moves its layer', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.apply({ oneShots: [shot({ lane: { kind: 'sfx' } })], ambient: [] });
    await flush();
    engine.setCameraScale(FAR_ZOOM_SCALE);
    const gain = ((ctx.sources[0] as FakeSource).connectedTo[0] as FakePanner).connectedTo[0] as FakeGain;
    expect(gain.gain.value).toBeCloseTo(0.42, 9);
    expect(gain.gain.ramps).toEqual([]);
  });
});
