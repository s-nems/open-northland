import { describe, expect, it } from 'vitest';
import {
  CLICK_FREE_RAMP_S,
  CLOSE_GRACE_S,
  DEFAULT_VOLUMES,
  MENU_MUSIC_TIMING,
  MUSIC_DUCK_GAIN,
  MUSIC_DUCK_RAMP_S,
  MUSIC_STOP_FADE_S,
  MUSIC_SWITCH_TIMING,
  type MusicCue,
  type MusicSequence,
  type MusicTrack,
  musicBusGain,
  parseMusicManifest,
  trackRotation,
  WebAudioEngine,
} from '../src/index.js';
import { FakeContext, type FakeGain, type FakeSource, flush } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';
import { manifestDocument, musicTrack } from './helpers/music-manifest.js';

/**
 * The music path end to end minus the browser: the manifest parse, and the engine's music bus +
 * player (a cue's passes through the seamless loop region, the levelling gain, cut-ins and pass-end
 * handovers, the rotation's advance, mute/resume reconciliation, memoised failed load, volume curves,
 * the jingle duck). Which cue comes next is covered in `music-playlist`.
 */

/** The fake serves a 4-byte buffer, and one fetched byte decodes to one second. */
const TRACK_S = 4;

/** A 4 s file whose first pass ends at 2 s, so a cue's pass boundaries fall at 2, 4, 6... */
const TRACK = musicTrack('theme_viking_neutral');
const ATTACK = musicTrack('attack_arabs');

describe('music manifest', () => {
  /** Why a document was rejected, or null when it parsed. */
  const rejection = (raw: unknown): string | null => {
    const read = parseMusicManifest(raw);
    return read.manifest === null ? read.rejected : null;
  };

  it('reads only the layout this build writes, so stale content is silent rather than misread', () => {
    const document = manifestDocument({ theme_viking_neutral: TRACK });
    expect(parseMusicManifest(document).manifest?.tracks.theme_viking_neutral).toEqual(TRACK);
    expect(rejection({ ...document, version: document.version - 1 })).toEqual(expect.any(String));
    expect(rejection({ tracks: document.tracks })).toEqual(expect.any(String));
  });

  it('rejects a row without its loudness correction or with a backwards loop region', () => {
    const { gainDb: _dropped, ...ungained } = TRACK;
    expect(rejection(manifestDocument({ a: ungained as MusicTrack }))).toEqual(expect.any(String));
    const backwards = { ...TRACK, loopStartS: 4, loopEndS: 2 };
    expect(rejection(manifestDocument({ a: backwards }))).toEqual(expect.any(String));
  });
});

interface Harness {
  readonly engine: WebAudioEngine;
  readonly ctx: FakeContext;
  readonly fetched: string[];
}

function makeEngine(opts: { failFetch?: boolean; failFile?: string } = {}): Harness {
  const ctx = new FakeContext();
  const fetched: string[] = [];
  const engine = new WebAudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => {
      fetched.push(url);
      if (opts.failFetch || (opts.failFile !== undefined && url.endsWith(opts.failFile))) {
        throw new Error('missing track');
      }
      return new ArrayBuffer(4);
    },
  });
  return { engine, ctx, fetched };
}

const PASSES = 3;
const FADE_S = 1;
const GAP_S = 10;

/** Hands out cues of `tracks` in turn, each with the same passes, silence and fade, until dropped. */
function cues(
  tracks: readonly MusicTrack[],
  passes = PASSES,
): MusicSequence & { readonly dropped: string[] } {
  const dropped: string[] = [];
  let at = 0;
  return {
    dropped,
    next(): MusicCue | null {
      const live = tracks.filter((track) => !dropped.includes(track.file));
      const track = live[at++ % Math.max(1, live.length)];
      return track === undefined ? null : { track, passes, gapBeforeS: GAP_S, fadeS: FADE_S };
    },
    drop(file) {
      dropped.push(file);
    },
  };
}

/** The fade gain a source plays through. */
const gainOf = (source: FakeSource): FakeGain => source.connectedTo[0] as FakeGain;

describe('WebAudioEngine music', () => {
  it('plays a cue’s passes through the loop region into the music bus', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK]));
    await flush();
    expect(fetched).toEqual(['/music/theme_viking_neutral.ogg']);
    const source = ctx.sources[0] as FakeSource;
    expect(source.started).toBe(true);
    // The first pass, then the published region repeated: the way the original repeats a segment.
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(TRACK.loopStartS);
    expect(source.loopEnd).toBe(TRACK.loopEndS);
    const loopS = TRACK.loopEndS - TRACK.loopStartS;
    expect(source.playsForS).toBe(TRACK.loopStartS + (PASSES - 1) * loopS);
    // source → fade gain → music bus → jingle duck → voice duck → master.
    const fade = gainOf(source);
    const { master, buses, duck } = mixerGraph(ctx);
    const musicBus = buses.music;
    expect(fade.connectedTo[0]).toBe(musicBus);
    expect(musicBus.gain.value).toBeCloseTo(musicBusGain(DEFAULT_VOLUMES.music), 5);
    expect(musicBus.connectedTo[0]).toBe(duck);
    const voiceDuck = duck.connectedTo[0] as FakeGain;
    expect(voiceDuck.connectedTo[0]).toBe(master);
  });

  it('opens a cue at its track’s levelling gain and lands it on silence at its last sample', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const LOUD_TRACK_GAIN_DB = -6;
    engine.setMusic(cues([{ ...TRACK, gainDb: LOUD_TRACK_GAIN_DB }], 1));
    await flush();
    const gain = gainOf(ctx.sources[0] as FakeSource);
    const level = 10 ** (LOUD_TRACK_GAIN_DB / 20);
    expect(gain.gain.events[0]).toEqual({ kind: 'set', value: 0, time: 0 });
    expect(gain.gain.ramps).toEqual([
      { value: level, time: CLICK_FREE_RAMP_S },
      { value: 0, time: TRACK.loopStartS },
    ]);
    expect(gain.gain.events).toContainEqual({ kind: 'set', value: level, time: TRACK.loopStartS - FADE_S });
  });

  it('starts music requested before the unlocking gesture on resume()', async () => {
    const { engine, ctx } = makeEngine();
    engine.setMusic(cues([TRACK]));
    await flush();
    expect(ctx.sources).toHaveLength(0); // still suspended - nothing plays
    await engine.resume();
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('opens the next cue after its silence once the running one plays out', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK, ATTACK]));
    await flush();
    const first = ctx.sources[0] as FakeSource;
    expect(first.startedAt).toBe(0); // the opening cue skips its silence
    first.onended?.();
    await flush();
    expect(fetched.at(-1)).toBe('/music/attack_arabs.ogg');
    const endsAt = first.playsForS ?? 0;
    expect((ctx.sources[1] as FakeSource).startedAt).toBeCloseTo(endsAt + GAP_S, 5);
  });

  it('cuts over at once: the running cue fades and the next opens right behind it', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK, ATTACK]));
    await flush();
    ctx.currentTime = 1;
    engine.transitionMusic('now');
    await flush();
    expect(ctx.sources).toHaveLength(2);
    const [old, next] = ctx.sources as [FakeSource, FakeSource];
    const silentAt = 1 + MUSIC_SWITCH_TIMING.fadeS;
    expect(old.stoppedAt).toBeCloseTo(silentAt, 5);
    expect(gainOf(old).gain.ramps.at(-1)).toEqual({ value: 0, time: silentAt });
    // A cut-in skips the cue's own silence.
    expect(next.startedAt).toBeCloseTo(silentAt + MUSIC_SWITCH_TIMING.gapS, 5);
  });

  it('ends a cue at its next pass boundary that leaves room for the fade', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK, ATTACK]));
    await flush();
    const first = ctx.sources[0] as FakeSource;
    // Boundaries fall at 2, 4 and 6 s; at 2.5 s with a 1 s fade the first that fits is 4 s.
    ctx.currentTime = 2.5;
    const BOUNDARY = 4;
    engine.transitionMusic('atPassEnd');
    await flush();
    expect(first.stoppedAt).toBe(BOUNDARY);
    expect(gainOf(first).gain.events).toContainEqual({ kind: 'set', value: 1, time: BOUNDARY - FADE_S });
    expect(gainOf(first).gain.ramps.at(-1)).toEqual({ value: 0, time: BOUNDARY });
    // The next cue follows its silence from the boundary, not from the full three passes.
    expect((ctx.sources[1] as FakeSource).startedAt).toBeCloseTo(BOUNDARY + GAP_S, 5);
  });

  it('leaves a cue alone when its own end is the nearest boundary', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK], 1));
    await flush();
    ctx.currentTime = 0.5;
    engine.transitionMusic('atPassEnd');
    expect((ctx.sources[0] as FakeSource).stoppedAt).toBeNull();
  });

  it('calls off a pending pass-end handover when the fight flares up again', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK, ATTACK]));
    await flush();
    const first = ctx.sources[0] as FakeSource;
    // The fake ends a source as soon as a stop is scheduled; this one keeps playing to its stop time.
    first.stop = (at: number) => {
      first.stoppedAt = at;
    };
    const fullEnd = first.playsForS ?? 0;
    ctx.currentTime = 2.5;
    engine.transitionMusic('atPassEnd');
    expect(first.stoppedAt).toBe(4);
    ctx.currentTime = 2.7;
    engine.transitionMusic('keep');
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect(first.stoppedAt).toBe(fullEnd);
    expect(gainOf(first).gain.ramps.at(-1)).toEqual({ value: 0, time: fullEnd });
  });

  it('cuts over instead when the cue is already fading toward its handover', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK, ATTACK]));
    await flush();
    const first = ctx.sources[0] as FakeSource;
    first.stop = (at: number) => {
      first.stoppedAt = at;
    };
    ctx.currentTime = 2.5;
    engine.transitionMusic('atPassEnd');
    ctx.currentTime = 3.5; // inside the fade that lands on the 4 s boundary
    engine.transitionMusic('keep');
    await flush();
    expect(ctx.sources).toHaveLength(2);
  });

  it('replaces a cue that is still loading when the mood calms', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK, ATTACK]));
    engine.transitionMusic('atPassEnd'); // before the first load lands
    await flush();
    expect(fetched).toEqual(['/music/theme_viking_neutral.ogg', '/music/attack_arabs.ogg']);
    expect(ctx.sources).toHaveLength(1);
  });

  it('drops a failed track from its sequence even when a cut-in superseded its load', async () => {
    const { engine, ctx } = makeEngine({ failFile: TRACK.file });
    await engine.resume();
    const sequence = cues([TRACK, ATTACK]);
    engine.setMusic(sequence);
    engine.transitionMusic('now'); // while the first load is in flight
    await flush();
    expect(sequence.dropped).toEqual([TRACK.file]);
    expect(ctx.sources).toHaveLength(1);
  });

  it('drops a track that failed under an earlier sequence before fetching it again', async () => {
    const { engine, ctx, fetched } = makeEngine({ failFile: TRACK.file });
    await engine.resume();
    engine.setMusic(cues([TRACK, ATTACK]));
    await flush();
    const next = cues([TRACK, ATTACK]);
    engine.setMusic(next);
    await flush();
    expect(next.dropped).toEqual([TRACK.file]);
    expect(fetched.filter((url) => url.endsWith(TRACK.file))).toHaveLength(1);
    expect(ctx.sources).toHaveLength(2);
  });

  it('waits out a stop fade before opening the next cue, so the two never overlap', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK]));
    await flush();
    ctx.currentTime = 3;
    engine.setEnabled(false); // fades out over MUSIC_STOP_FADE_S, but stays audible until then
    ctx.currentTime = 3.2;
    engine.setEnabled(true);
    await flush();
    const [old, next] = ctx.sources as [FakeSource, FakeSource];
    expect(old.stoppedAt).toBeCloseTo(3 + MUSIC_STOP_FADE_S, 5);
    expect(next.startedAt).toBeGreaterThanOrEqual(old.stoppedAt ?? 0);
  });

  it('releases a finished cue’s nodes instead of leaving them on the music bus', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK]));
    await flush();
    const source = ctx.sources[0] as FakeSource;
    source.onended?.();
    await flush();
    expect(source.disconnected).toBe(true);
    expect(gainOf(source).disconnected).toBe(true);
  });

  it('stops on mute and resumes the sequence on unmute', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK]));
    await flush();
    engine.setEnabled(false);
    expect((ctx.sources[0] as FakeSource).stoppedAt).not.toBeNull();
    engine.setEnabled(true);
    await flush();
    expect(ctx.sources).toHaveLength(2);
  });

  it('installs only one source when mute/unmute races an in-flight load', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK]));
    engine.setEnabled(false); // both while the first fetch is still in flight
    engine.setEnabled(true);
    await flush();
    expect(ctx.sources.filter((s) => s.started && s.stoppedAt === null)).toHaveLength(1);
  });

  it('keeps a running sequence going when the same one is asserted again', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const sequence = cues([TRACK]);
    engine.setMusic(sequence);
    await flush();
    engine.setMusic(sequence);
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('re-fetches nothing when returning to a recently played track', async () => {
    const { engine, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK, ATTACK]));
    await flush();
    engine.transitionMusic('now');
    await flush();
    engine.transitionMusic('now'); // back to the first track, within the decoded-buffer cache
    await flush();
    expect(fetched.filter((u) => u.endsWith('theme_viking_neutral.ogg'))).toHaveLength(1);
  });

  it('restarts the music a suspension dropped once the context runs again', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    ctx.refuseResume = true; // no activation: the engine's own resume is refused
    engine.setMusic(cues([TRACK]));
    ctx.setState('suspended'); // before the track's load lands
    await flush();
    expect(ctx.sources).toHaveLength(0);
    ctx.setState('running'); // the interruption ends and the platform resumes the context
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('retries a track whose load landed while the context was suspended', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK]));
    ctx.refuseResume = true;
    ctx.setState('suspended'); // external interruption (no stop()) while the load is in flight
    await flush();
    expect(ctx.sources).toHaveLength(0);
    ctx.refuseResume = false;
    await engine.resume();
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('drops a track that cannot load from the sequence and falls silent once none is left', async () => {
    const { engine, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    const sequence = cues([TRACK, ATTACK]);
    engine.setMusic(sequence);
    await flush();
    for (let frame = 0; frame < 20; frame++) engine.setMusic(sequence); // re-asserted every frame
    await flush();
    expect(sequence.dropped).toEqual([TRACK.file, ATTACK.file]);
    expect(fetched).toHaveLength(2); // each tried once, no spin between failures
  });

  it('stops pulling from a sequence that offers a failed track again', async () => {
    const { engine, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    const stubborn: MusicSequence = {
      next: () => ({ track: TRACK, passes: 1, gapBeforeS: 0, fadeS: FADE_S }),
      drop: () => undefined,
    };
    engine.setMusic(stubborn);
    await flush();
    expect(fetched).toHaveLength(1);
  });

  it('keeps a failed track out of its sequence after a mute', async () => {
    const { engine, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    engine.setMusic(cues([TRACK]));
    await flush();
    engine.setEnabled(false);
    engine.setEnabled(true);
    await flush();
    expect(fetched).toHaveLength(1);
  });

  it('drops music that was replaced while its load was in flight', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(cues([TRACK]));
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
    engine.setMusic(trackRotation(ROTATION));
    await flush();
    const first = ctx.sources[0] as FakeSource;
    expect(first.startedAt).toBe(0);
    expect(gainOf(first).gain.ramps.at(-1)).toEqual({ value: 0, time: TRACK_S });
    first.onended?.();
    await flush();
    expect(fetched).toEqual(['/music/one.ogg', '/music/two.ogg']);
    const second = ctx.sources[1] as FakeSource;
    expect(second.startedAt).toBeCloseTo(TRACK_S + MENU_MUSIC_TIMING.gapS, 5);
    expect(gainOf(second).gain.ramps.at(-1)).toEqual({
      value: 0,
      time: TRACK_S + MENU_MUSIC_TIMING.gapS + TRACK_S,
    });
  });

  it('plays only the first pass of an entry whose file carries the ring-loop’s second pass', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(trackRotation([TRACK]));
    await flush();
    const first = ctx.sources[0] as FakeSource;
    expect(first.loop).toBe(false);
    expect(first.playsForS).toBe(TRACK.loopStartS);
  });

  it('wraps to the first entry after the last one, playing every entry in order', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(trackRotation(ROTATION));
    await flush();
    for (let i = 0; i < ROTATION.length; i++) {
      (ctx.sources[i] as FakeSource).onended?.();
      await flush();
    }
    expect(fetched).toEqual(['/music/one.ogg', '/music/two.ogg', '/music/three.ogg', '/music/one.ogg']);
  });

  it('does not advance on the ended event a mute-driven stop fires', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(trackRotation(ROTATION));
    await flush();
    engine.setEnabled(false); // stop() ends the source, which must not read as "track finished"
    await flush();
    expect(fetched).toEqual(['/music/one.ogg']);
    expect(ctx.sources.filter((s) => s.stoppedAt === null)).toHaveLength(0);
  });

  it('drops entries that cannot load and falls silent once none is left', async () => {
    const { engine, ctx, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    engine.setMusic(trackRotation(ROTATION));
    await flush();
    expect(fetched).toHaveLength(ROTATION.length); // each tried once, no spin between failures
    expect(ctx.sources).toHaveLength(0);
  });

  it('releases the context on close and goes silent', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    engine.setMusic(trackRotation(ROTATION));
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
  const JINGLE_HOLD_MS = 3700;
  const JINGLE_HOLD_S = JINGLE_HOLD_MS / 1000;
  const DUCKED_FRAME = {
    oneShots: [
      { files: ['jingles_birth.wav'], gain: 0.9, pan: 0, key: 'settlerBorn:1', duckMusicMs: JINGLE_HOLD_MS },
    ],
    ambient: [],
  };

  it('ducks the music while a jingle rings and schedules the lift at the end of the hold', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const { duck } = mixerGraph(ctx);
    engine.apply(DUCKED_FRAME);
    await flush(); // the duck lands with the wav, once its load resolves
    // No later frame is needed: a hidden tab that draws nothing still gets its music back.
    expect(duck.gain.events).toEqual([
      { kind: 'cancel', value: 1, time: 0 },
      { kind: 'set', value: 1, time: 0 },
      { kind: 'ramp', value: MUSIC_DUCK_GAIN, time: MUSIC_DUCK_RAMP_S },
      { kind: 'set', value: MUSIC_DUCK_GAIN, time: JINGLE_HOLD_S },
      { kind: 'ramp', value: 1, time: JINGLE_HOLD_S + MUSIC_DUCK_RAMP_S },
    ]);
  });

  it('moves the scheduled lift instead of re-ramping when a second jingle lands', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const { duck } = mixerGraph(ctx);
    engine.apply(DUCKED_FRAME);
    await flush();
    const SECOND_AT_S = 2;
    const SECOND_HOLD_MS = 3200;
    ctx.currentTime = SECOND_AT_S;
    engine.apply({
      oneShots: [
        {
          files: ['jingles_death.wav'],
          gain: 0.9,
          pan: 0,
          key: 'settlerDied:2',
          duckMusicMs: SECOND_HOLD_MS,
        },
      ],
      ambient: [],
    });
    await flush();
    const liftAt = SECOND_AT_S + SECOND_HOLD_MS / 1000;
    expect(duck.gain.ramps.filter((ramp) => ramp.value === MUSIC_DUCK_GAIN)).toHaveLength(1);
    expect(duck.gain.events.slice(-3)).toEqual([
      { kind: 'cancel', value: 1, time: JINGLE_HOLD_S },
      { kind: 'set', value: MUSIC_DUCK_GAIN, time: liftAt },
      { kind: 'ramp', value: 1, time: liftAt + MUSIC_DUCK_RAMP_S },
    ]);
  });

  it('leaves the music alone when the jingle wav fails to load', async () => {
    const { engine, ctx } = makeEngine({ failFetch: true });
    await engine.resume();
    const { duck } = mixerGraph(ctx);
    engine.apply(DUCKED_FRAME);
    await flush();
    expect(duck.gain.ramps).toHaveLength(0);
  });
});
