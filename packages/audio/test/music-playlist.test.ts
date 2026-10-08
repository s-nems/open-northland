import { describe, expect, it } from 'vitest';
import {
  CALM_PASSES_MAX,
  CALM_PASSES_MIN,
  CALM_SILENCE_MAX_S,
  CALM_SILENCE_MIN_S,
  type MusicCue,
  type MusicManifest,
  MusicPlaylist,
  type MusicRandom,
  mapMusicFor,
  OWN_STEM_EVERY_MAX,
  OWN_STEM_EVERY_MIN,
  type PlaylistMood,
  parseMusicManifest,
  TENSE_PASSES,
} from '../src/index.js';
import { manifestDocument, musicTrack } from './helpers/music-manifest.js';

/**
 * The in-game rotation: the map's own stem first and every second or third calm cue, shuffle-bag
 * picks with silence between them otherwise, a fight cutting in on the own tense stem and holding
 * each tense stem for several passes. Everything is drawn from the injected source, so a seed pins it.
 */

const THEME_VIKING = 2;
const MISSION_FRANKEN1 = 11;
const MISSION_MIDGARD1 = 20;
const MISSION_ADDON_FRANKEN2 = 34;
const MISSION_ADDON_UNDERWORLD = 37;
const SEED = 7;
const LONG_RUN = 200;

/** mulberry32: a small seeded uniform source, standing in for the browser's `Math.random`. */
function seeded(seed: number): MusicRandom {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** The Frank and Norse segments the cases need; the add-on Franken2 stems repeat Franken1's audio. */
const STEMS = [
  'mission_franken1_standard',
  'mission_franken1_wealthy',
  'mission_franken1_danger',
  'mission_franken2_standard',
  'mission_franken2_wealthy',
  'mission_franken2_danger',
  'mission_addon_franken1_standard',
  'theme_franken_friendly',
  'theme_franken_neutral',
  'theme_franken_hostile',
  'attack_franken',
  'mission_midgard1_standard',
  'theme_viking_friendly',
  'theme_viking_neutral',
  'theme_viking_hostile',
  'mission_midgard2_standard',
  'mission_viking1_danger',
  'attack_viking',
  'mission_addon_nordland_standard',
  'mission_addon_asgard_standard',
  'mission_addon_underworld_standard',
];
const ADDON_FRANKEN2 = ['standard', 'wealthy', 'danger'].map((mood) => [
  `mission_addon_franken2_${mood}`,
  `mission_franken1_${mood}`,
]);

function fixture(): MusicManifest {
  const tracks = Object.fromEntries([
    ...STEMS.map((stem) => [stem, musicTrack(stem)]),
    ...ADDON_FRANKEN2.map(([addon = '', base = '']) => [addon, musicTrack(addon, { sameAudioAs: base })]),
  ]);
  const manifest = parseMusicManifest(manifestDocument(tracks));
  if (manifest === null) throw new Error('the fixture manifest must parse');
  return manifest;
}
const MANIFEST = fixture();

const CALM: PlaylistMood = { intensity: 'calm', stance: 'neutral', wealthy: false };
const TENSE: PlaylistMood = { ...CALM, intensity: 'tense' };

function playlistFor(musicType: number, random: MusicRandom = seeded(SEED)): MusicPlaylist {
  const music = mapMusicFor(musicType, MANIFEST);
  if (music === null) throw new Error(`no music for ${musicType}`);
  return new MusicPlaylist(music, MANIFEST, random);
}

function take(playlist: MusicPlaylist, count: number): MusicCue[] {
  const taken: MusicCue[] = [];
  for (let i = 0; i < count; i++) {
    const cue = playlist.next();
    if (cue === null) break;
    taken.push(cue);
  }
  return taken;
}

const stemOf = (cue: MusicCue): string => cue.track.file.replace(/\.ogg$/, '');

describe('calm rotation', () => {
  it('opens on the map’s own stem at once, for one or two passes', () => {
    const [first] = take(playlistFor(MISSION_FRANKEN1), 1);
    expect(first?.track.file).toBe('mission_franken1_standard.ogg');
    expect(first?.gapBeforeS).toBe(0);
    expect(first?.passes).toBeGreaterThanOrEqual(CALM_PASSES_MIN);
    expect(first?.passes).toBeLessThanOrEqual(CALM_PASSES_MAX);
  });

  it('draws the same rotation from the same seed', () => {
    // The add-on Franken2 Wealthy name stands for Franken1 Wealthy: one stem per audio, first by name.
    expect(take(playlistFor(MISSION_FRANKEN1), 8).map(stemOf)).toEqual([
      'mission_franken1_standard',
      'theme_franken_friendly',
      'mission_franken1_standard',
      'mission_franken2_standard',
      'mission_franken1_standard',
      'mission_addon_franken2_wealthy',
      'mission_franken1_standard',
      'mission_franken2_wealthy',
    ]);
  });

  it('never plays the same audio twice in a row', () => {
    const cues = take(playlistFor(MISSION_FRANKEN1), LONG_RUN);
    expect(cues).toHaveLength(LONG_RUN);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]?.track.segmentSha256).not.toBe(cues[i - 1]?.track.segmentSha256);
    }
  });

  it('returns to the own stem every second or third cue', () => {
    const cues = take(playlistFor(MISSION_FRANKEN1), LONG_RUN);
    const ownAt = cues.flatMap((cue, i) => (stemOf(cue) === 'mission_franken1_standard' ? [i] : []));
    expect(ownAt[0]).toBe(0);
    for (let i = 1; i < ownAt.length; i++) {
      const every = (ownAt[i] ?? 0) - (ownAt[i - 1] ?? 0);
      expect(every).toBeGreaterThanOrEqual(OWN_STEM_EVERY_MIN);
      expect(every).toBeLessThanOrEqual(OWN_STEM_EVERY_MAX);
    }
  });

  it('puts silence before every cue after the first and plays every calm stem in turn', () => {
    const cues = take(playlistFor(MISSION_FRANKEN1), LONG_RUN);
    for (const cue of cues.slice(1)) {
      expect(cue.gapBeforeS).toBeGreaterThanOrEqual(CALM_SILENCE_MIN_S);
      expect(cue.gapBeforeS).toBeLessThanOrEqual(CALM_SILENCE_MAX_S);
    }
    const audioOf = (stem: string) => MANIFEST.tracks[stem]?.segmentSha256;
    expect(new Set(cues.map((cue) => cue.track.segmentSha256))).toEqual(
      new Set(mapMusicFor(MISSION_FRANKEN1, MANIFEST)?.pools.calm.map(audioOf)),
    );
  });

  it('never picks a stem that is the own stem’s audio under another name', () => {
    const cues = take(playlistFor(MISSION_ADDON_FRANKEN2), LONG_RUN);
    const stems = new Set(cues.map(stemOf));
    expect(stems.has('mission_addon_franken2_standard')).toBe(true);
    expect(stems.has('mission_franken1_standard')).toBe(false);
  });

  it('follows the standing into the Wealthy stem at the next own slot', () => {
    const playlist = playlistFor(MISSION_FRANKEN1);
    take(playlist, 1);
    playlist.update({ ...CALM, wealthy: true });
    const own = take(playlist, OWN_STEM_EVERY_MAX).map(stemOf);
    expect(own).toContain('mission_franken1_wealthy');
    expect(own).not.toContain('mission_franken1_standard');
  });

  it('rotates Underworld through its own stem and the borrowed Norse ones', () => {
    const stems = new Set(take(playlistFor(MISSION_ADDON_UNDERWORLD), LONG_RUN).map(stemOf));
    expect(stems).toEqual(
      new Set([
        'mission_addon_underworld_standard',
        'mission_addon_nordland_standard',
        'mission_addon_asgard_standard',
      ]),
    );
  });
});

describe('fights', () => {
  it('keeps a tense cue still running out its pass when the fight flares up again', () => {
    const playlist = playlistFor(MISSION_FRANKEN1);
    take(playlist, 1);
    playlist.update(TENSE);
    const [danger] = take(playlist, 1);
    expect(playlist.update(CALM)).toBe('atPassEnd');
    expect(playlist.update(TENSE)).toBe('keep');
    // When the kept cue ends, the fight rotates on rather than restarting the same stem.
    expect(take(playlist, 1)[0]?.track.segmentSha256).not.toBe(danger?.track.segmentSha256);
  });

  it('keeps the own tense stem when it is already playing as the calm one', () => {
    const playlist = playlistFor(THEME_VIKING);
    playlist.update({ ...CALM, stance: 'enemy' });
    expect(take(playlist, 1).map(stemOf)).toEqual(['theme_viking_hostile']);
    expect(playlist.update({ ...TENSE, stance: 'enemy' })).toBe('keep');
    expect(take(playlist, 1).map(stemOf)).not.toContain('theme_viking_hostile');
  });

  it('cuts in at once and calms at a pass end, saying nothing while the mood holds', () => {
    const playlist = playlistFor(MISSION_FRANKEN1);
    expect(playlist.update(CALM)).toBe('none');
    expect(playlist.update(TENSE)).toBe('now');
    expect(playlist.update(TENSE)).toBe('none');
    expect(playlist.update(CALM)).toBe('atPassEnd');
  });

  it('opens a fight on the map’s own tense stem, held for several passes with no silence', () => {
    const playlist = playlistFor(MISSION_FRANKEN1);
    take(playlist, 1);
    playlist.update(TENSE);
    const [first, second] = take(playlist, 2);
    expect(first).toMatchObject({ passes: TENSE_PASSES, gapBeforeS: 0 });
    expect(first?.track.file).toBe('mission_franken1_danger.ogg');
    // Only after those passes does the fight rotate, to another tense stem.
    expect(second).toMatchObject({ passes: TENSE_PASSES, gapBeforeS: 0 });
    expect(mapMusicFor(MISSION_FRANKEN1, MANIFEST)?.pools.tense).toContain(stemOf(second as MusicCue));
    expect(second?.track.segmentSha256).not.toBe(first?.track.segmentSha256);
  });

  it('fights a map with no Danger segment to its culture’s tense music, never its calm stem', () => {
    const playlist = playlistFor(MISSION_MIDGARD1);
    take(playlist, 1);
    playlist.update(TENSE);
    const cues = take(playlist, LONG_RUN);
    expect(
      cues.every((cue) => mapMusicFor(MISSION_MIDGARD1, MANIFEST)?.pools.tense.includes(stemOf(cue))),
    ).toBe(true);
  });

  it('goes back to the calm rotation with silence once the fight is over', () => {
    const playlist = playlistFor(MISSION_FRANKEN1);
    take(playlist, 1);
    playlist.update(TENSE);
    take(playlist, 1);
    playlist.update(CALM);
    const [calm] = take(playlist, 1);
    expect(calm?.gapBeforeS).toBeGreaterThanOrEqual(CALM_SILENCE_MIN_S);
    expect(mapMusicFor(MISSION_FRANKEN1, MANIFEST)?.pools.calm).toContain(stemOf(calm as MusicCue));
  });
});

describe('dropped tracks', () => {
  it('never offers a dropped file again and ends once every stem is gone', () => {
    const playlist = playlistFor(MISSION_ADDON_UNDERWORLD);
    playlist.drop('mission_addon_nordland_standard.ogg');
    const stems = new Set(take(playlist, LONG_RUN).map(stemOf));
    expect(stems.has('mission_addon_nordland_standard')).toBe(false);
    playlist.drop('mission_addon_underworld_standard.ogg');
    playlist.drop('mission_addon_asgard_standard.ogg');
    expect(playlist.next()).toBeNull();
  });
});
