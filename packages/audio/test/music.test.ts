import { describe, expect, it, vi } from 'vitest';
import {
  CALM_MOOD,
  CLICK_FREE_RAMP_S,
  CLOSE_GRACE_S,
  DEFAULT_VOLUMES,
  MENU_MUSIC_TIMING,
  MUSIC_DUCK_GAIN,
  MUSIC_STOP_FADE_S,
  MUSIC_SWITCH_TIMING,
  musicBusGain,
  musicTrackFor,
  parseMusicManifest,
  WebAudioEngine,
} from '../src/index.js';
import { FakeContext, type FakeGain, type FakeSource, flush } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';
import { manifestDocument, musicTrack } from './helpers/music-manifest.js';

/**
 * The music path end to end minus the browser: the manifest parse, and the engine's music bus +
 * player (the game track's seamless ring-loop, the menu rotation's queue advance, mute/resume
 * reconciliation, memoised failed load, volume curves, the jingle duck). Mood selection is covered
 * in `music-mood`.
 */

/** The fake serves a 4-byte buffer, and one fetched byte decodes to one second. */
const TRACK_S = 4;

const VIKING_NEUTRAL = musicTrack('theme_viking_neutral');
const MANIFEST = parseMusicManifest(manifestDocument({ theme_viking_neutral: VIKING_NEUTRAL }));

describe('music selection', () => {
  it('resolves a rendered stem through the manifest', () => {
    const THEME_VIKING = 2;
    expect(musicTrackFor(THEME_VIKING, 'neutral', CALM_MOOD, 0, MANIFEST)).toEqual(VIKING_NEUTRAL);
  });

  it('has no track for a known code whose stem was never rendered', () => {
    const MISSION_VIKING1 = 10;
    expect(musicTrackFor(MISSION_VIKING1, 'neutral', CALM_MOOD, 0, MANIFEST)).toBeNull();
  });
});

describe('music manifest', () => {
  const SILENCED = () => undefined;

  it('reads only the layout this build writes, so stale content is silent rather than misread', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(SILENCED);
    const document = manifestDocument({ theme_viking_neutral: VIKING_NEUTRAL });
    expect(parseMusicManifest(document)?.tracks.theme_viking_neutral).toEqual(VIKING_NEUTRAL);
    expect(parseMusicManifest({ ...document, version: document.version - 1 })).toBeNull();
    expect(parseMusicManifest({ tracks: document.tracks })).toBeNull();
    warn.mockRestore();
  });

  it('rejects a row without its loudness correction or with a backwards loop region', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(SILENCED);
    const { gainDb: _dropped, ...ungained } = VIKING_NEUTRAL;
    expect(parseMusicManifest(manifestDocument({ a: ungained as typeof VIKING_NEUTRAL }))).toBeNull();
    const backwards = { ...VIKING_NEUTRAL, loopStartS: 4, loopEndS: 2 };
    expect(parseMusicManifest(manifestDocument({ a: backwards }))).toBeNull();
    warn.mockRestore();
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

const TRACK = VIKING_NEUTRAL;
const ATTACK = musicTrack('attack_arabs');

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
    // source → fade gain → music bus → duck → master.
    const fade = source.connectedTo[0] as FakeGain;
    const { master, buses, duck } = mixerGraph(ctx);
    const musicBus = buses.music;
    expect(fade.connectedTo[0]).toBe(musicBus);
    expect(musicBus.gain.value).toBeCloseTo(musicBusGain(DEFAULT_VOLUMES.music), 5);
    expect(musicBus.connectedTo[0]).toBe(duck);
    expect(duck.connectedTo[0]).toBe(master);
  });

  it('opens a track at its levelling gain through a click-free ramp', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const LOUD_TRACK_GAIN_DB = -6;
    engine.setMusic({ ...TRACK, gainDb: LOUD_TRACK_GAIN_DB });
    await flush();
    const gain = (ctx.sources[0] as FakeSource).connectedTo[0] as FakeGain;
    expect(gain.gain.events[0]).toEqual({ kind: 'set', value: 0, time: 0 });
    expect(gain.gain.ramps).toEqual([{ value: 10 ** (LOUD_TRACK_GAIN_DB / 20), time: CLICK_FREE_RAMP_S }]);
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
    expect(gain.gain.ramps.every((ramp) => ramp.value > 0)).toBe(true);
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
    engine.setMusic(ATTACK);
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
    engine.setMusic(ATTACK);
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

  it('restarts the music a suspension dropped once the context runs again', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    ctx.refuseResume = true; // no activation: the engine's own resume is refused
    engine.setMusic(TRACK);
    ctx.setState('suspended'); // before the track's load lands
    await flush();
    expect(ctx.sources).toHaveLength(0);
    ctx.setState('running'); // the interruption ends and the platform resumes the context
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
  // A first pass as long as the fake's whole 4 s buffer, so an entry plays the buffer out.
  const ROTATION = ['one', 'two', 'three'].map((stem) =>
    musicTrack(stem, { loopStartS: TRACK_S, loopEndS: 2 * TRACK_S }),
  );

  it('plays one entry through, landing it on silence a gap before the next opens', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusicRotation(ROTATION);
    await flush();
    const first = ctx.sources[0] as FakeSource;
    expect(first.startedAt).toBe(0);
    // The one ramp lands the entry on silence at its last sample, so nothing is cut mid-level.
    expect((first.connectedTo[0] as FakeGain).gain.ramps.at(-1)).toEqual({ value: 0, time: TRACK_S });
    first.onended?.();
    await flush();
    expect(fetched).toEqual(['/music/one.ogg', '/music/two.ogg']);
    const second = ctx.sources[1] as FakeSource;
    expect(second.startedAt).toBeCloseTo(MENU_MUSIC_TIMING.gapS, 5);
    expect((second.connectedTo[0] as FakeGain).gain.ramps.at(-1)).toEqual({
      value: 0,
      time: MENU_MUSIC_TIMING.gapS + TRACK_S,
    });
  });

  it('plays only the first pass of an entry whose file carries the ring-loop’s second pass', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusicRotation([TRACK]);
    await flush();
    const first = ctx.sources[0] as FakeSource;
    expect(first.loop).toBe(false);
    expect(first.playsForS).toBe(TRACK.loopStartS);
    expect((first.connectedTo[0] as FakeGain).gain.ramps.at(-1)).toEqual({
      value: 0,
      time: TRACK.loopStartS,
    });
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
    expect(engine.audible).toBe(false);
    await new Promise((r) => setTimeout(r, CLOSE_GRACE_S * 1000 + 10));
    expect(ctx.state).toBe('closed');
  });
});

describe('WebAudioEngine volumes', () => {
  it('puts the original -5 dB music offset (less the -3 dB the files bake in) under the slider curve', () => {
    expect(musicBusGain(100)).toBeCloseTo(10 ** (-2 / 20), 6);
    expect(musicBusGain(50)).toBeCloseTo(10 ** (-27 / 20), 6);
    expect(musicBusGain(0)).toBe(0);
  });

  it('ramps the music bus through its curve and clamps the slider', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const musicBus = mixerGraph(ctx).buses.music;
    engine.setVolumes({ ...DEFAULT_VOLUMES, music: 25 });
    expect(musicBus.gain.ramps.at(-1)?.value).toBeCloseTo(musicBusGain(25), 5);
    engine.setVolumes({ ...DEFAULT_VOLUMES, music: -2 });
    expect(musicBus.gain.ramps.at(-1)?.value).toBe(0);
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
    const { duck } = mixerGraph(ctx);
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
    const { duck } = mixerGraph(ctx);
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
    const { duck } = mixerGraph(ctx);
    engine.apply(DUCKED_FRAME);
    await flush();
    expect(duck.gain.ramps).toHaveLength(0);
  });

  it('does not duck for a debounced repeat of the same jingle', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const { duck } = mixerGraph(ctx);
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
