import { describe, expect, it } from 'vitest';
import { AMBIENT_FADE_S, ONE_SHOT_COOLDOWN_S, WebAudioEngine } from '../src/index.js';
import type { OneShot } from '../src/index.js';

/**
 * The Web Audio engine, exercised through its injected platform seams (a fake context + a stub
 * loader + a scripted random): the one-shot gain/pan graph, the cooldown debounce, the memoised
 * failed load, the ambient start/retune/stop reconciliation and the mute-during-load race — all
 * without a browser.
 */

class FakeParam {
  value = 0;
  /** Every linearRamp target scheduled on this param, in order. */
  ramps: Array<{ value: number; time: number }> = [];
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.ramps.push({ value, time });
    this.value = value;
  }
}

class FakeNode {
  readonly connectedTo: unknown[] = [];
  connect<T>(node: T): T {
    this.connectedTo.push(node);
    return node;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakePanner extends FakeNode {
  pan = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  started = false;
  stoppedAt: number | null = null;
  start(): void {
    this.started = true;
  }
  stop(at: number): void {
    this.stoppedAt = at;
  }
}

class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createStereoPanner(): FakePanner {
    return new FakePanner();
  }
  async decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    return { length: bytes.byteLength } as unknown as AudioBuffer;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
}

/** Let the load→decode→play promise chain settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

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
  it('plays a one-shot through a pan+gain graph into the master', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    expect(engine.started).toBe(true);
    engine.apply({ oneShots: [shot()], ambient: [] });
    await flush();
    expect(fetched).toEqual(['/sounds/sfx/hammer.wav']);
    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0] as FakeSource;
    expect(source.started).toBe(true);
    // source → panner (pan applied) → gain (shot gain) → master (created first, at default volume).
    const panner = source.connectedTo[0] as FakePanner;
    expect(panner.pan.value).toBeCloseTo(-0.3, 5);
    const gain = panner.connectedTo[0] as FakeGain;
    expect(gain.gain.value).toBeCloseTo(0.42, 5);
    expect(gain.connectedTo[0]).toBe(ctx.gains[0]); // the master gain
    expect(ctx.gains[0]?.connectedTo[0]).toBe(ctx.destination);
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
});
