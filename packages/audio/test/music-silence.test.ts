import { describe, expect, it } from 'vitest';
import { VOICE_DUCK_DIP_S, VOICE_DUCK_RELEASE_S, WebAudioEngine } from '../src/index.js';
import { MUSIC_SILENCE_HOLD_S } from '../src/web/engine/audio-engine.js';
import { FakeContext, type FakeGain } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';

/** A film's silence over the music: a full mute on the voice duck from the take to the release. */

const SILENT = 0;

function makeEngine(): { readonly engine: WebAudioEngine; readonly ctx: FakeContext } {
  const ctx = new FakeContext();
  const engine = new WebAudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async () => new ArrayBuffer(1),
  });
  return { engine, ctx };
}

function voiceDuckOf(ctx: FakeContext): FakeGain {
  return mixerGraph(ctx).duck.connectedTo[0] as FakeGain;
}

describe('music silence', () => {
  it('drops the music out at once and lifts it on release', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const param = voiceDuckOf(ctx).gain;
    const release = engine.silenceMusic();
    expect(param.ramps[0]).toEqual({ value: SILENT, time: VOICE_DUCK_DIP_S });
    expect(param.events.at(-2)).toEqual({ kind: 'set', value: SILENT, time: MUSIC_SILENCE_HOLD_S });
    const RELEASE_AT_S = 30;
    ctx.currentTime = RELEASE_AT_S;
    release();
    expect(param.events.slice(-2)).toEqual([
      { kind: 'set', value: SILENT, time: RELEASE_AT_S },
      { kind: 'ramp', value: 1, time: RELEASE_AT_S + VOICE_DUCK_RELEASE_S },
    ]);
    const events = param.events.length;
    release();
    expect(param.events).toHaveLength(events);
  });

  it('keeps the music silent while another silence still runs', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const param = voiceDuckOf(ctx).gain;
    const first = engine.silenceMusic();
    const second = engine.silenceMusic();
    ctx.currentTime = 1;
    first();
    expect(param.events.at(-2)).toEqual({ kind: 'set', value: SILENT, time: MUSIC_SILENCE_HOLD_S });
    const RELEASE_AT_S = 2;
    ctx.currentTime = RELEASE_AT_S;
    second();
    expect(param.events.at(-2)).toEqual({ kind: 'set', value: SILENT, time: RELEASE_AT_S });
  });

  it('holds a silence taken before audio starts from the context start', async () => {
    const { engine, ctx } = makeEngine();
    const release = engine.silenceMusic();
    await engine.resume();
    const param = voiceDuckOf(ctx).gain;
    expect(param.ramps[0]).toEqual({ value: SILENT, time: VOICE_DUCK_DIP_S });
    ctx.currentTime = 1;
    release();
    expect(param.ramps.at(-1)).toEqual({ value: 1, time: 1 + VOICE_DUCK_RELEASE_S });
  });

  it('leaves a silence released before audio starts out of the context', async () => {
    const { engine, ctx } = makeEngine();
    engine.silenceMusic()();
    await engine.resume();
    expect(voiceDuckOf(ctx).gain.ramps).toHaveLength(0);
  });
});
