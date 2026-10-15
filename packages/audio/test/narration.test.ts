import { describe, expect, it } from 'vitest';
import { CLICK_FREE_RAMP_S, VOICE_DUCK_DIP_S, VOICE_MUSIC_DUCK_DB, WebAudioEngine } from '../src/index.js';
import { FakeContext, type FakeGain } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';

/** A briefing page's narration: one clip at a time on the `ui` bus, cut by the next or a stop. */

/** The lowest rate a Web Audio buffer holds, so test clips stay small. */
const RATE = 3000;
const DUCKED = 10 ** (VOICE_MUSIC_DUCK_DB / 20);
const PCM_16 = 16;

/** A mono 16-bit PCM wav of `seconds` at `rate`, every sample at half scale. */
function clip(seconds: number, rate = RATE): Uint8Array {
  const frames = seconds * Math.min(rate, RATE);
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (const [i, c] of [...text].entries()) view.setUint8(at + i, c.charCodeAt(0));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, PCM_16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, 16384, true);
  return bytes;
}

/** A context that refuses a buffer at the clips' rate, as a browser does past its limits; the engine's
 *  own buffers at the context rate still build. */
class RefusingContext extends FakeContext {
  override createBuffer(channels: number, length: number, sampleRate: number) {
    if (sampleRate === RATE) throw new DOMException('unsupported buffer', 'NotSupportedError');
    return super.createBuffer(channels, length, sampleRate);
  }
}

/** When the lift scheduled last on the voice duck starts. */
function lastLift(ctx: FakeContext): number | undefined {
  const voiceDuck = mixerGraph(ctx).duck.connectedTo[0] as FakeGain;
  return voiceDuck.gain.events.filter((event) => event.kind === 'set' && event.value === DUCKED).at(-1)?.time;
}

async function running(ctx = new FakeContext()): Promise<{ engine: WebAudioEngine; ctx: FakeContext }> {
  const engine = new WebAudioEngine({ createContext: () => ctx as unknown as AudioContext });
  await engine.resume();
  return { engine, ctx };
}

describe('narration', () => {
  it('speaks the clip on the ui bus and dips the music for its length', async () => {
    const { engine, ctx } = await running();
    const { buses, duck } = mixerGraph(ctx);
    engine.playNarration(clip(3));
    const source = ctx.sources.at(-1);
    if (source === undefined) throw new Error('no narration source');
    expect(source.started).toBe(true);
    const buffer = source.buffer as AudioBuffer;
    expect(buffer.duration).toBe(3);
    expect(buffer.getChannelData(0)[0]).toBe(0.5);
    const gain = source.connectedTo[0] as { connectedTo: unknown[] };
    expect(gain.connectedTo).toEqual([buses.ui]);
    const voiceDuck = duck.connectedTo[0] as { gain: { ramps: { value: number }[] } };
    expect(voiceDuck.gain.ramps[0]?.value).toBeCloseTo(10 ** (VOICE_MUSIC_DUCK_DB / 20));
  });

  it('cuts the line still speaking when the next starts or a stop comes', async () => {
    const { engine, ctx } = await running();
    engine.playNarration(clip(3));
    const first = ctx.sources.at(-1);
    engine.playNarration(clip(2));
    expect(first?.stoppedAt).toBe(CLICK_FREE_RAMP_S);
    const second = ctx.sources.at(-1);
    engine.stopNarration();
    expect(second?.stoppedAt).toBe(CLICK_FREE_RAMP_S);
  });

  it('stays silent for bytes that are no wav', async () => {
    const { engine, ctx } = await running();
    const before = ctx.sources.length;
    engine.playNarration(new Uint8Array([1, 2, 3]));
    expect(ctx.sources.length).toBe(before);
  });

  it('stays silent while muted', async () => {
    const { engine, ctx } = await running();
    engine.setEnabled(false);
    const before = ctx.sources.length;
    engine.playNarration(clip(1));
    expect(ctx.sources.length).toBe(before);
  });

  it('waits for the gesture that starts audio, unless a stop comes first', async () => {
    const ctx = new FakeContext();
    const engine = new WebAudioEngine({ createContext: () => ctx as unknown as AudioContext });
    engine.playNarration(clip(1));
    await engine.resume();
    expect(ctx.sources.filter((source) => source.started)).toHaveLength(1);

    const later = new FakeContext();
    const stopped = new WebAudioEngine({ createContext: () => later as unknown as AudioContext });
    stopped.playNarration(clip(1));
    stopped.stopNarration();
    await stopped.resume();
    expect(later.sources.filter((source) => source.started)).toHaveLength(0);
  });

  it('lifts the music when a stop cuts the line, not at the end of the clip', async () => {
    const { engine, ctx } = await running();
    engine.playNarration(clip(45));
    expect(lastLift(ctx)).toBe(45);
    const STOP_AT_S = 2;
    ctx.currentTime = STOP_AT_S;
    engine.stopNarration();
    expect(lastLift(ctx)).toBe(STOP_AT_S);
  });

  it('keeps one dip across page turns, ending with the line still speaking', async () => {
    const { engine, ctx } = await running();
    engine.playNarration(clip(45));
    ctx.currentTime = 1;
    engine.playNarration(clip(3));
    expect(lastLift(ctx)).toBe(1 + 3);
  });

  it('never lifts before the dip has landed', async () => {
    const { engine, ctx } = await running();
    engine.playNarration(clip(45));
    engine.stopNarration();
    expect(lastLift(ctx)).toBe(VOICE_DUCK_DIP_S);
  });

  it('stays silent for a clip the context cannot hold, now or once audio starts', async () => {
    const refusing = new RefusingContext();
    const { engine } = await running(refusing);
    const before = refusing.sources.length;
    expect(() => engine.playNarration(clip(1))).not.toThrow();
    expect(refusing.sources).toHaveLength(before);

    const pending = new RefusingContext();
    const waiting = new WebAudioEngine({ createContext: () => pending as unknown as AudioContext });
    waiting.playNarration(clip(1));
    await waiting.resume();
    expect(pending.sources.filter((source) => source.started)).toHaveLength(0);
  });

  it('stays silent for a rate no context holds', async () => {
    const { engine, ctx } = await running();
    const before = ctx.sources.length;
    const ABSURD_RATE = 1_000_000;
    engine.playNarration(clip(1, ABSURD_RATE));
    expect(ctx.sources).toHaveLength(before);
  });
});
