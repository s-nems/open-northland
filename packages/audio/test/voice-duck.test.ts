import { describe, expect, it } from 'vitest';
import {
  BUS_DUCK_RAMP_S,
  DEFAULT_SOUNDS_BASE_URL,
  type OneShot,
  VOICE_DUCK_DIP_S,
  VOICE_DUCK_RELEASE_S,
  VOICE_MUSIC_DUCK_DB,
  WebAudioEngine,
} from '../src/index.js';
import { BusDuck } from '../src/web/engine/bus-duck.js';
import { FakeContext, type FakeGain, flush } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';

/**
 * The music's dip under a spoken line: an answer, a selection's line or an alert holds the music bus
 * a few dB down for its decoded wav, overlapping lines share one hold at one depth, and the lift is
 * scheduled on the audio clock to ramp back over its own release.
 */

/** The fake decoder makes a wav last as many seconds as it has bytes. */
const LINE_S = 2;
const LONG_LINE_S = 3;
const DUCKED = 10 ** (VOICE_MUSIC_DUCK_DB / 20);

function makeEngine(): { readonly engine: WebAudioEngine; readonly ctx: FakeContext } {
  const ctx = new FakeContext();
  const engine = new WebAudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) =>
      new ArrayBuffer(url === `${DEFAULT_SOUNDS_BASE_URL}long.wav` ? LONG_LINE_S : LINE_S),
  });
  return { engine, ctx };
}

function line(file: string, extra: Partial<OneShot> = {}): OneShot {
  return { files: [file], gain: 1, pan: 0, key: file, duckMusicDb: VOICE_MUSIC_DUCK_DB, ...extra };
}

/** The voice duck: the gain the jingle duck feeds on the music's way to the master. */
function voiceDuckOf(ctx: FakeContext): FakeGain {
  return mixerGraph(ctx).duck.connectedTo[0] as FakeGain;
}

async function play(engine: WebAudioEngine, shots: readonly OneShot[]): Promise<void> {
  engine.apply({ oneShots: shots, ambient: [] });
  await flush(); // a dip lands with its wav, once the load resolves
}

describe('voice duck', () => {
  it('dips the music under a line, leaving the jingle duck and the other buses alone', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const { master, buses, duck: jingleDuck } = mixerGraph(ctx);
    const voiceDuck = voiceDuckOf(ctx);
    expect(voiceDuck.connectedTo).toEqual([master]);
    await play(engine, [line('ok.wav')]);
    expect(voiceDuck.gain.ramps[0]).toEqual({ value: DUCKED, time: VOICE_DUCK_DIP_S });
    expect(jingleDuck.gain.ramps).toHaveLength(0);
    for (const bus of [buses.ui, buses.voice, buses.world]) expect(bus.gain.ramps).toHaveLength(0);
  });

  it('schedules its lift at the end of the decoded line with no later frame', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const voiceDuck = voiceDuckOf(ctx);
    await play(engine, [line('ok.wav')]);
    expect(voiceDuck.gain.events.slice(-2)).toEqual([
      { kind: 'set', value: DUCKED, time: LINE_S },
      { kind: 'ramp', value: 1, time: LINE_S + VOICE_DUCK_RELEASE_S },
    ]);
  });

  it('coalesces overlapping lines into one hold at one depth, never stacking', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const voiceDuck = voiceDuckOf(ctx);
    // Two lines in one frame and a third, longer one while they still speak.
    await play(engine, [line('ok.wav'), line('yes.wav')]);
    const LONG_AT_S = 1;
    ctx.currentTime = LONG_AT_S;
    await play(engine, [line('long.wav')]);
    expect(voiceDuck.gain.ramps.filter((ramp) => ramp.value === DUCKED)).toHaveLength(1);
    // The third line moves the lift the first two scheduled to its own end.
    const liftAt = LONG_AT_S + LONG_LINE_S;
    expect(voiceDuck.gain.events.slice(-3)).toEqual([
      { kind: 'cancel', value: 1, time: LINE_S },
      { kind: 'set', value: DUCKED, time: liftAt },
      { kind: 'ramp', value: 1, time: liftAt + VOICE_DUCK_RELEASE_S },
    ]);
  });

  it('holds a delayed layer to its end and dips again from the release a new line lands in', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const voiceDuck = voiceDuckOf(ctx);
    const DELAY_S = 0.5;
    await play(engine, [line('ok.wav', { delayS: DELAY_S })]);
    expect(voiceDuck.gain.events.at(-2)).toEqual({ kind: 'set', value: DUCKED, time: LINE_S + DELAY_S });
    // A line inside the release ramps down from where the music stands, replacing the lift.
    ctx.currentTime = LINE_S + DELAY_S + VOICE_DUCK_RELEASE_S / 2;
    await play(engine, [line('yes.wav')]);
    const [cancel, anchor, dip] = voiceDuck.gain.events.slice(-5);
    expect(cancel).toMatchObject({ kind: 'cancel', time: ctx.currentTime });
    expect(anchor).toMatchObject({ kind: 'set', time: ctx.currentTime });
    expect(dip).toEqual({ kind: 'ramp', value: DUCKED, time: ctx.currentTime + VOICE_DUCK_DIP_S });
  });

  it('leaves the music alone under a shot without a voice duck', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    await play(engine, [{ files: ['chatter.wav'], gain: 1, pan: 0, key: 'c', lane: { kind: 'voice' } }]);
    expect(ctx.sources).toHaveLength(1);
    expect(voiceDuckOf(ctx).gain.ramps).toHaveLength(0);
  });
});

describe('bus duck', () => {
  const SHALLOW_DB = -6;
  const DEEP_DB = -12;
  const HOLD_S = 2;

  it('deepens a held dip from where it stands and keeps the later lift', () => {
    const ctx = new FakeContext();
    const duck = new BusDuck(ctx as unknown as BaseAudioContext);
    const param = (duck.node as unknown as FakeGain).gain;
    duck.hold(ctx as unknown as BaseAudioContext, SHALLOW_DB, HOLD_S);
    const DEEPER_AT_S = 1;
    ctx.currentTime = DEEPER_AT_S;
    duck.hold(ctx as unknown as BaseAudioContext, DEEP_DB, HOLD_S / 2);
    const deep = 10 ** (DEEP_DB / 20);
    expect(param.events.slice(-5)).toEqual([
      { kind: 'cancel', value: 1, time: DEEPER_AT_S },
      { kind: 'set', value: 1, time: DEEPER_AT_S },
      { kind: 'ramp', value: deep, time: DEEPER_AT_S + BUS_DUCK_RAMP_S },
      { kind: 'set', value: deep, time: HOLD_S },
      { kind: 'ramp', value: 1, time: HOLD_S + BUS_DUCK_RAMP_S },
    ]);
  });
});
