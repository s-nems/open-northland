import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MUSIC_VOLUME,
  MUSIC_FADE_S,
  musicTrackForType,
  parseMusicManifest,
  WebAudioEngine,
} from '../src/index.js';
import { FakeContext, type FakeGain, type FakeSource, flush } from './helpers/fake-audio.js';

/**
 * The music path end to end minus the browser: the pure manifest/type selection, and the engine's
 * music bus + player (intro-then-loop source setup, crossfade on change, mute/resume reconciliation,
 * memoised failed load, volume ramps).
 */

const MANIFEST = parseMusicManifest({
  tracks: {
    theme_viking_neutral: { file: 'theme_viking_neutral.ogg', loopStartS: 8.5 },
    attack_arabs: { file: 'attack_arabs.ogg' },
  },
});

describe('music selection', () => {
  it('maps a musictype code through the manifest to a track', () => {
    expect(musicTrackForType(2, MANIFEST)).toEqual({ file: 'theme_viking_neutral.ogg', loopStartS: 8.5 });
    expect(musicTrackForType(9, MANIFEST)).toEqual({ file: 'attack_arabs.ogg' });
  });

  it('returns null for an unrendered stem, a jingle code, and no manifest', () => {
    expect(musicTrackForType(10, MANIFEST)).toBeNull(); // known code, not rendered
    expect(musicTrackForType(22, MANIFEST)).toBeNull(); // jingle codes are wav one-shots
    expect(musicTrackForType(2, null)).toBeNull();
  });

  it('parses tolerantly: junk entries drop, junk roots are null', () => {
    expect(parseMusicManifest(null)).toBeNull();
    expect(parseMusicManifest({ tracks: 'nope' })).toBeNull();
    const partial = parseMusicManifest({ tracks: { ok: { file: 'ok.ogg' }, bad: { file: 42 } } });
    expect(partial?.tracks).toEqual({ ok: { file: 'ok.ogg' } });
  });
});

interface Harness {
  readonly engine: WebAudioEngine;
  readonly ctx: FakeContext;
  readonly fetched: string[];
}

function makeEngine(opts: { failFetch?: boolean } = {}): Harness {
  const ctx = new FakeContext();
  const fetched: string[] = [];
  const engine = new WebAudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => {
      fetched.push(url);
      if (opts.failFetch) throw new Error('missing track');
      return new ArrayBuffer(4);
    },
    random: () => 0,
  });
  return { engine, ctx, fetched };
}

const TRACK = { file: 'theme_viking_neutral.ogg', loopStartS: 8.5 } as const;

describe('WebAudioEngine music', () => {
  it('plays the desired track as an intro-then-infinite-loop into the music bus', async () => {
    const { engine, ctx, fetched } = makeEngine();
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    expect(fetched).toEqual(['/music/theme_viking_neutral.ogg']);
    const source = ctx.sources[0] as FakeSource;
    expect(source.started).toBe(true);
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBeCloseTo(8.5, 5);
    expect(source.loopEnd).toBe(0); // 0 = the buffer's end
    // source → fade gain → music bus (gains: master, sfx, music) → master.
    const fade = source.connectedTo[0] as FakeGain;
    const [master, , musicBus] = ctx.gains as [FakeGain, FakeGain, FakeGain];
    expect(fade.connectedTo[0]).toBe(musicBus);
    expect(musicBus.gain.value).toBeCloseTo(DEFAULT_MUSIC_VOLUME, 5);
    expect(musicBus.connectedTo[0]).toBe(master);
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

  it('crossfades to a changed track and keeps an unchanged one running', async () => {
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
    expect(old.stoppedAt).toBeCloseTo(10 + MUSIC_FADE_S, 5);
    const oldFade = old.connectedTo[0] as FakeGain;
    expect(oldFade.gain.ramps.at(-1)?.value).toBe(0);
    const nextFade = next.connectedTo[0] as FakeGain;
    expect(nextFade.gain.ramps.at(-1)?.value).toBe(1);
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
    ctx.state = 'suspended'; // external interruption (no stop()) while the load is in flight
    await flush();
    expect(ctx.sources).toHaveLength(0);
    await engine.resume();
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('memoises a failed track load and never re-fetches it', async () => {
    const { engine, fetched } = makeEngine({ failFetch: true });
    await engine.resume();
    engine.setMusic(TRACK);
    await flush();
    engine.setEnabled(false);
    engine.setEnabled(true); // re-set of the desired track must not re-fetch
    await flush();
    expect(fetched).toEqual(['/music/theme_viking_neutral.ogg']);
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

describe('WebAudioEngine volumes', () => {
  it('ramps the buses on setSfxVolume/setMusicVolume and clamps to 0..1', async () => {
    const { engine, ctx } = makeEngine();
    await engine.resume();
    const [, sfxBus, musicBus] = ctx.gains as [FakeGain, FakeGain, FakeGain];
    engine.setSfxVolume(0.25);
    engine.setMusicVolume(1.5);
    expect(sfxBus.gain.ramps.at(-1)?.value).toBeCloseTo(0.25, 5);
    expect(musicBus.gain.ramps.at(-1)?.value).toBe(1);
    engine.setMusicVolume(-2);
    expect(musicBus.gain.ramps.at(-1)?.value).toBe(0);
  });

  it('applies a volume set before the context exists once it is created', async () => {
    const { engine, ctx } = makeEngine();
    engine.setMusicVolume(0.1);
    await engine.resume();
    const [, , musicBus] = ctx.gains as [FakeGain, FakeGain, FakeGain];
    expect(musicBus.gain.value).toBeCloseTo(0.1, 5);
  });
});
