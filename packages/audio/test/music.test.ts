import { describe, expect, it } from 'vitest';
import {
  CALM_MOOD,
  DEFAULT_MUSIC_VOLUME,
  MENU_MUSIC_TIMING,
  MUSIC_DUCK_GAIN,
  MUSIC_STOP_FADE_S,
  MUSIC_SWITCH_TIMING,
  musicBusGain,
  musicTrackFor,
  parseMusicManifest,
  sfxBusGain,
  WebAudioEngine,
} from '../src/index.js';
import { FakeContext, type FakeGain, type FakeSource, flush } from './helpers/fake-audio.js';

/**
 * The music path end to end minus the browser: the manifest parse, and the engine's music bus +
 * player (the game track's seamless ring-loop, the menu rotation's queue advance, mute/resume
 * reconciliation, memoised failed load, volume curves, the jingle duck). Mood selection is covered
 * in `music-mood`.
 */

/** The fake serves a 4-byte buffer, and one fetched byte decodes to one second. */
const TRACK_S = 4;

const MANIFEST = parseMusicManifest({
  tracks: {
    theme_viking_neutral: { file: 'theme_viking_neutral.ogg', loopStartS: 2, loopEndS: 4 },
    attack_arabs: { file: 'attack_arabs.ogg' },
  },
});

describe('music selection', () => {
  it('resolves a rendered stem through the manifest', () => {
    const THEME_VIKING = 2;
    expect(musicTrackFor(THEME_VIKING, 'neutral', CALM_MOOD, 0, MANIFEST)).toEqual({
      file: 'theme_viking_neutral.ogg',
      loopStartS: 2,
      loopEndS: 4,
    });
  });

  it('has no track for a known code whose stem was never rendered', () => {
    const MISSION_VIKING1 = 10;
    expect(musicTrackFor(MISSION_VIKING1, 'neutral', CALM_MOOD, 0, MANIFEST)).toBeNull();
  });

  it('parses tolerantly: junk entries drop, junk roots are null', () => {
    expect(parseMusicManifest(null)).toBeNull();
    expect(parseMusicManifest({ tracks: 'nope' })).toBeNull();
    const partial = parseMusicManifest({ tracks: { ok: { file: 'ok.ogg' }, bad: { file: 42 } } });
    expect(partial?.tracks).toEqual({ ok: { file: 'ok.ogg' } });
  });

  it('drops an unusable loop region but keeps its track playable', () => {
    const parsed = parseMusicManifest({
      tracks: {
        backwards: { file: 'a.ogg', loopStartS: 4, loopEndS: 2 },
        negative: { file: 'b.ogg', loopStartS: -1, loopEndS: 2 },
        partial: { file: 'c.ogg', loopStartS: 1 },
      },
    });
    expect(parsed?.tracks).toEqual({
      backwards: { file: 'a.ogg' },
      negative: { file: 'b.ogg' },
      partial: { file: 'c.ogg' },
    });
  });
});

interface Harness {
  readonly engine: WebAudioEngine;
  readonly ctx: FakeContext;
  readonly fetched: string[];
}

function makeEngine(opts: { failFetch?: boolean; random?: () => number } = {}): Harness {
  const ctx = new FakeContext();
  const fetched: string[] = [];
  const engine = new WebAudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => {
      fetched.push(url);
      if (opts.failFetch) throw new Error('missing track');
      return new ArrayBuffer(4);
    },
    random: opts.random ?? (() => 0),
  });
  return { engine, ctx, fetched };
}

const TRACK = { file: 'theme_viking_neutral.ogg', loopStartS: 2, loopEndS: 4 } as const;

describe('WebAudioEngine music', () => {
  it('ring-loops the desired track into the music bus', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    expect(fetched).toEqual(['/music/theme_viking_neutral.ogg']);
    const source = ctx.sources[0] as FakeSource;
    expect(source.started).toBe(true);
    // The published region loops seamlessly, the way the original repeats a segment.
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(2);
    expect(source.loopEnd).toBe(4);
    // source → fade gain → music bus (gains: master, sfx, music, duck) → duck → master.
    const fade = source.connectedTo[0] as FakeGain;
    const [master, , musicBus, duck] = ctx.gains as [FakeGain, FakeGain, FakeGain, FakeGain];
    expect(fade.connectedTo[0]).toBe(musicBus);
    expect(musicBus.gain.value).toBeCloseTo(musicBusGain(DEFAULT_MUSIC_VOLUME), 5);
    expect(musicBus.connectedTo[0]).toBe(duck);
    expect(duck.connectedTo[0]).toBe(master);
  });

  it('loops the whole file when the manifest published no loop region', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic({ file: 'attack_arabs.ogg' });
    await flush();
    const source = ctx.sources[0] as FakeSource;
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0);
    expect(source.loopEnd).toBe(0); // untouched - the source loops its full buffer
  });

  it('starts a track requested before the unlocking gesture on resume()', async () => {
    const { engine, ctx } = makeEngine();
    engine.setMusic(TRACK);
    await flush();
    expect(ctx.sources).toHaveLength(0); // still suspended - nothing plays
    await engine.resume();
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('schedules no end fade on a looping track - it never runs out', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    const gain = (ctx.sources[0] as FakeSource).connectedTo[0] as FakeGain;
    expect(gain.gain.ramps).toEqual([]);
  });

  it('fades a mood switch over while the replacement opens right behind it', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    engine.setMusic(TRACK); // same file - no restart
    await flush();
    expect(ctx.sources).toHaveLength(1);
    ctx.currentTime = 10;
    engine.setMusic({ file: 'attack_arabs.ogg' });
    await flush();
    expect(ctx.sources).toHaveLength(2);
    const [old, next] = ctx.sources as [FakeSource, FakeSource];
    const silentAt = 10 + MUSIC_SWITCH_TIMING.fadeS;
    expect(old.stoppedAt).toBeCloseTo(silentAt, 5);
    expect((old.connectedTo[0] as FakeGain).gain.ramps.at(-1)).toEqual({ value: 0, time: silentAt });
    expect(next.startedAt).toBeCloseTo(silentAt + MUSIC_SWITCH_TIMING.gapS, 5);
  });

  it('waits out a stop fade before opening the next track, so the two never overlap', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    ctx.currentTime = 30;
    engine.setEnabled(false); // fades out over MUSIC_STOP_FADE_S, but stays audible until then
    ctx.currentTime = 30.2;
    engine.setEnabled(true);
    await flush();
    const [old, next] = ctx.sources as [FakeSource, FakeSource];
    expect(old.stoppedAt).toBeCloseTo(30 + MUSIC_STOP_FADE_S, 5);
    expect(next.startedAt).toBeGreaterThanOrEqual(old.stoppedAt ?? 0);
  });

  it('releases a finished track’s nodes instead of leaving them on the music bus', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    const source = ctx.sources[0] as FakeSource;
    const gain = source.connectedTo[0] as FakeGain;
    source.onended?.();
    await flush();
    expect(source.disconnected).toBe(true);
    expect(gain.disconnected).toBe(true);
  });

  it('stops on mute and resumes the desired track on unmute', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    engine.setEnabled(false);
    expect((ctx.sources[0] as FakeSource).stoppedAt).not.toBeNull();
    engine.setEnabled(true);
    await flush();
    expect(ctx.sources).toHaveLength(2); // restarted from the remembered desired track
  });

  it('installs only one source when mute/unmute races an in-flight load', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    engine.setEnabled(false); // both while the first fetch is still in flight
    engine.setEnabled(true);
    await flush();
    expect(ctx.sources.filter((s) => s.started && s.stoppedAt === null)).toHaveLength(1);
  });

  it('re-fetches nothing when returning to a recently played track', async () => {
    const { engine, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    engine.setMusic({ file: 'attack_arabs.ogg' });
    await flush();
    engine.setMusic(TRACK); // back within the decoded-buffer cache
    await flush();
    expect(fetched.filter((u) => u.endsWith('theme_viking_neutral.ogg'))).toHaveLength(1);
  });

  it('retries a track whose load landed while the context was suspended', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    ctx.refuseResume = true; // no user activation, so the engine's own resume is refused
    ctx.setState('suspended'); // external interruption (no stop()) while the load is in flight
    await flush();
    expect(ctx.sources).toHaveLength(0);
    ctx.refuseResume = false;
    await engine.resume();
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('does not re-fetch a failed track while the same one stays desired', async () => {
    const { engine, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    for (let frame = 0; frame < 20; frame++) engine.setMusic(TRACK); // the driver re-asserts per frame
    await flush();
    expect(fetched).toEqual(['/music/theme_viking_neutral.ogg']);
  });

  it('gives a failed track another chance after a mute, so a network blip is not permanent', async () => {
    const { engine, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    engine.setEnabled(false);
    engine.setEnabled(true);
    await flush();
    expect(fetched).toHaveLength(2);
  });

  it('drops a track that was replaced while its load was in flight', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    engine.setMusic(null); // replaced before the fetch resolved
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });
});

describe('WebAudioEngine music rotation', () => {
  const ROTATION = [{ file: 'one.ogg' }, { file: 'two.ogg' }, { file: 'three.ogg' }];

  it('plays one entry through, landing it on silence a gap before the next opens', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusicRotation(ROTATION);
    await flush();
    const first = ctx.sources[0] as FakeSource;
    expect(first.startedAt).toBe(0);
    // The one ramp lands the entry on silence at its last sample, so nothing is cut mid-level.
    expect((first.connectedTo[0] as FakeGain).gain.ramps).toEqual([{ value: 0, time: TRACK_S }]);
    first.onended?.();
    await flush();
    expect(fetched).toEqual(['/music/one.ogg', '/music/two.ogg']);
    const second = ctx.sources[1] as FakeSource;
    expect(second.startedAt).toBeCloseTo(MENU_MUSIC_TIMING.gapS, 5);
    expect((second.connectedTo[0] as FakeGain).gain.ramps).toEqual([
      { value: 0, time: MENU_MUSIC_TIMING.gapS + TRACK_S },
    ]);
  });

  it('plays only the first pass of an entry whose file carries the ring-loop’s second pass', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusicRotation([TRACK]);
    await flush();
    const first = ctx.sources[0] as FakeSource;
    expect(first.loop).toBe(false);
    expect(first.playsForS).toBe(TRACK.loopStartS);
    expect((first.connectedTo[0] as FakeGain).gain.ramps).toEqual([{ value: 0, time: TRACK.loopStartS }]);
  });

  it('wraps to the first entry after the last one, playing every entry in order', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusicRotation(ROTATION);
    await flush();
    for (let i = 0; i < ROTATION.length; i++) {
      (ctx.sources[i] as FakeSource).onended?.();
      await flush();
    }
    expect(fetched).toEqual(['/music/one.ogg', '/music/two.ogg', '/music/three.ogg', '/music/one.ogg']);
  });

  it('keeps a running rotation going when the same rotation is asserted again', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusicRotation(ROTATION);
    await flush();
    engine.setMusicRotation([...ROTATION]); // same tracks, fresh array
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('stops the rotation on mute and starts it again on unmute', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusicRotation(ROTATION);
    await flush();
    engine.setEnabled(false);
    expect((ctx.sources[0] as FakeSource).stoppedAt).not.toBeNull();
    engine.setEnabled(true);
    await flush();
    expect(ctx.sources).toHaveLength(2);
  });

  it('does not advance on the ended event a mute-driven stop fires', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusicRotation(ROTATION);
    await flush();
    engine.setEnabled(false); // stop() ends the source, which must not read as "track finished"
    await flush();
    expect(fetched).toEqual(['/music/one.ogg']);
    expect(ctx.sources.filter((s) => s.stoppedAt === null)).toHaveLength(0);
  });

  it('drops entries that cannot load and falls silent once none is left', async () => {
    const { engine, ctx, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    engine.setMusicRotation(ROTATION);
    await flush();
    expect(fetched).toHaveLength(ROTATION.length); // each tried once, no spin between failures
    expect(ctx.sources).toHaveLength(0);
  });

  it('releases the context on close and goes silent', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusicRotation(ROTATION);
    await flush();
    engine.close();
    expect((ctx.sources[0] as FakeSource).stoppedAt).not.toBeNull();
    expect(ctx.state).toBe('closed');
    expect(engine.audible).toBe(false);
  });
});

describe('WebAudioEngine volumes', () => {
  it('maps the music slider linearly in amplitude with the original -5 dB offset (-3 dB baked)', () => {
    expect(musicBusGain(1)).toBeCloseTo(10 ** (-2 / 20), 6);
    expect(musicBusGain(0.7)).toBeCloseTo(0.7 * 10 ** (-2 / 20), 6);
    expect(musicBusGain(0)).toBe(0);
  });

  it('maps the sfx slider linearly in dB over 20 dB, muting only at zero', () => {
    expect(sfxBusGain(1)).toBe(1);
    expect(sfxBusGain(0.5)).toBeCloseTo(10 ** -0.5, 6);
    expect(sfxBusGain(0.05)).toBeCloseTo(10 ** -0.95, 6); // near the original's -20 dB floor
    expect(sfxBusGain(0)).toBe(0);
  });

  it('ramps the buses through the curves on the setters and clamps the sliders to 0..1', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const [, sfxBus, musicBus] = ctx.gains as [FakeGain, FakeGain, FakeGain];
    engine.setSfxVolume(0.25);
    engine.setMusicVolume(1.5);
    expect(sfxBus.gain.ramps.at(-1)?.value).toBeCloseTo(sfxBusGain(0.25), 5);
    expect(musicBus.gain.ramps.at(-1)?.value).toBeCloseTo(musicBusGain(1), 5);
    engine.setMusicVolume(-2);
    expect(musicBus.gain.ramps.at(-1)?.value).toBe(0);
  });

  it('applies a volume set before the context exists once it is created', async () => {
    const { engine, ctx } = makeEngine();
    engine.setMusicVolume(0.1);
    await engine.resume();
    const [, , musicBus] = ctx.gains as [FakeGain, FakeGain, FakeGain];
    expect(musicBus.gain.value).toBeCloseTo(musicBusGain(0.1), 5);
  });
});

describe('WebAudioEngine jingle duck', () => {
  const DUCKED_FRAME = {
    oneShots: [{ files: ['jingles_birth.wav'], gain: 0.9, pan: 0, key: 'settlerBorn:1', duckMusicMs: 3700 }],
    ambient: [],
  };
  const EMPTY_FRAME = { oneShots: [], ambient: [] };

  it('ducks the music while a jingle rings and restores it after the hold', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const duck = ctx.gains[3] as FakeGain;
    engine.apply(DUCKED_FRAME);
    await flush(); // the duck lands with the wav, once its load resolves
    expect(duck.gain.ramps.at(-1)?.value).toBeCloseTo(MUSIC_DUCK_GAIN, 5);
    ctx.currentTime = 1;
    engine.apply(EMPTY_FRAME); // hold still running - no restore yet
    expect(duck.gain.ramps).toHaveLength(1);
    ctx.currentTime = 3.7;
    engine.apply(EMPTY_FRAME);
    expect(duck.gain.ramps.at(-1)?.value).toBe(1);
  });

  it('extends a running duck instead of re-ramping when a second jingle lands', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const duck = ctx.gains[3] as FakeGain;
    engine.apply(DUCKED_FRAME);
    await flush();
    ctx.currentTime = 2;
    engine.apply({
      oneShots: [
        { files: ['jingles_death.wav'], gain: 0.9, pan: 0, key: 'settlerDied:2', duckMusicMs: 3200 },
      ],
      ambient: [],
    });
    await flush();
    expect(duck.gain.ramps).toHaveLength(1); // still down - only the hold moved
    ctx.currentTime = 4; // the first hold has run out, the second is still on
    engine.apply(EMPTY_FRAME);
    expect(duck.gain.ramps).toHaveLength(1);
    ctx.currentTime = 5.2;
    engine.apply(EMPTY_FRAME);
    expect(duck.gain.ramps.at(-1)?.value).toBe(1);
  });

  it('leaves the music alone when the jingle wav fails to load', async () => {
    const { engine, ctx } = makeEngine({ failFetch: true });
    await engine.resume();
    const duck = ctx.gains[3] as FakeGain;
    engine.apply(DUCKED_FRAME);
    await flush();
    expect(duck.gain.ramps).toHaveLength(0);
  });

  it('does not duck for a debounced repeat of the same jingle', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const duck = ctx.gains[3] as FakeGain;
    const shortHold = {
      oneShots: [{ files: ['jingles_birth.wav'], gain: 0.9, pan: 0, key: 'settlerBorn:1', duckMusicMs: 50 }],
      ambient: [],
    };
    engine.apply(shortHold);
    await flush();
    ctx.currentTime = 0.06;
    engine.apply(EMPTY_FRAME); // the short hold has run out - restored
    expect(duck.gain.ramps.at(-1)?.value).toBe(1);
    ctx.currentTime = 0.1; // inside the one-shot cooldown - the wav will not ring again
    engine.apply(shortHold);
    await flush();
    expect(duck.gain.ramps.at(-1)?.value).toBe(1);
  });
});
